#!/usr/bin/env python3
"""Whole-KB snapshots on the existing Docker host. No model or MCP calls.

Only completed directories enter the catalog. Restore is operator-only, with a
durable intent and pre-restore backup outside PostgreSQL. Stdout is JSON.
"""
import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sync_directory(path):
    if os.name != "nt":
        fd = os.open(path, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    with temp.open("x", encoding="utf-8") as f:
        os.chmod(temp, 0o600)
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, path)
    sync_directory(path.parent)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class Deferred(Exception):
    pass


class Docker:
    def __init__(self, kb):
        self.kb = Path(kb).resolve()
        if not (self.kb / "scripts/compose-git.sh").is_file():
            raise ValueError("KB source checkout/helper not found")

    def command(self, args, *, stdin=None, stdout=None):
        p = subprocess.run(args, stdin=stdin if stdin is not None else subprocess.DEVNULL,
                           stdout=stdout if stdout is not None else subprocess.PIPE,
                           stderr=subprocess.PIPE, check=False)
        if p.returncode:
            # Do not persist provider credentials or database connection strings.
            raise RuntimeError("Command failed: " + " ".join(args[:3]) + "; inspect Docker/service configuration")
        return p.stdout.decode() if stdout is None else None

    def compose(self, *args):
        return self.command(["bash", str(self.kb / "scripts/compose-git.sh"), *args])

    def sql(self, query):
        return json.loads(self.command(["docker", "exec", "survey-kb-db-1", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "kb", "-d", "kb", "-At", "-c", query]))

    def info(self):
        data = self.sql("""SELECT json_build_object(
          'schema',(SELECT json_agg(name ORDER BY name) FROM schema_migrations),
          'pg_major',current_setting('server_version_num')::int/10000,
          'database_bytes',pg_database_size(current_database()),
          'unfinished',(SELECT count(*) FROM jobs WHERE status<>'succeeded'),
          'open_transfers',(SELECT count(*) FROM trajectory_transfers WHERE receipt IS NULL),
          'papers',(SELECT count(*) FROM entities WHERE kind='paper'),
          'experiences',(SELECT count(*) FROM entities WHERE kind='experience'),
          'trajectories',(SELECT count(*) FROM trajectories),
          'jobs',(SELECT count(*) FROM jobs),
          'revisions_hash',(SELECT md5(COALESCE(string_agg(entity_id::text||':'||revision::text||':'||content_hash,',' ORDER BY entity_id,revision),'')) FROM revisions),
          'trajectories_hash',(SELECT md5(COALESCE(string_agg(id::text||':'||content_hash,',' ORDER BY id),'')) FROM trajectories),
          'entities_hash',(SELECT md5(COALESCE(string_agg(md5(row_to_json(e)::text),',' ORDER BY id),'')) FROM entities e),
          'sources_hash',(SELECT md5(COALESCE(string_agg(md5(row_to_json(s)::text),',' ORDER BY experience_id,trajectory_id,start_line,end_line),'')) FROM experience_sources s),
          'chunks_hash',(SELECT md5(COALESCE(string_agg(md5(row_to_json(c)::text),',' ORDER BY id),'')) FROM search_chunks c),
          'jobs_hash',(SELECT md5(COALESCE(string_agg(md5(row_to_json(j)::text),',' ORDER BY id),'')) FROM jobs j)
        )""")
        images = json.loads(self.command(["docker", "inspect", "survey-kb-api-1", "survey-kb-worker-1", "survey-kb-embedding-1"]))
        data["images"] = {x["Name"]: x["Image"] for x in images}
        data["embedding_model"] = [e for x in images if x["Name"] == "/survey-kb-embedding-1" for e in x["Config"]["Env"] if e.startswith(("MODEL_PATH=", "MODEL_REVISION="))]
        data["git"] = self.command(["git", "-C", str(self.kb), "rev-parse", "HEAD"]).strip()
        return data

    def services(self):
        rows = json.loads(self.command(["docker", "inspect", "survey-kb-api-1", "survey-kb-worker-1"]))
        return [r["Config"]["Labels"]["com.docker.compose.service"] for r in rows if r["State"]["Running"]]

    def stop(self):
        self.compose("stop", "-t", "330", "api", "worker")

    def start(self, services):
        if services:
            self.compose("start", *services)

    def dump(self, path):
        with Path(path).open("xb") as f:
            os.chmod(path, 0o600)
            self.command(["docker", "exec", "survey-kb-db-1", "pg_dump", "-U", "kb", "-d", "kb", "-Fc", "--no-owner", "--no-acl"], stdout=f)
            f.flush()
            os.fsync(f.fileno())
        with Path(path).open("rb") as f:
            self.command(["docker", "exec", "-i", "survey-kb-db-1", "pg_restore", "--list"], stdin=f)

    def restore(self, path):
        with Path(path).open("rb") as f:
            self.command(["docker", "exec", "-i", "survey-kb-db-1", "pg_restore", "-U", "kb", "-d", "kb", "--clean", "--if-exists", "--single-transaction", "--exit-on-error", "--no-owner", "--no-acl"], stdin=f)

    def receipts(self, jobs, records):
        # All values are validated before SQL construction; no untrusted SQL identifiers.
        for value in jobs + records:
            uuid.UUID(value)
        j = ",".join("'" + x + "'::uuid" for x in jobs) or "NULL::uuid"
        r = ",".join("'" + x + "'::uuid" for x in records) or "NULL::uuid"
        return self.sql(f"""SELECT json_build_object('jobs',(SELECT count(*) FROM jobs WHERE id IN ({j}) AND status='succeeded'),
          'records',(SELECT count(*) FROM (SELECT id FROM entities UNION ALL SELECT id FROM trajectories) x WHERE id IN ({r})))""")


class Snapshots:
    def __init__(self, directory, backend, pipeline):
        self.directory = Path(directory).resolve()
        self.pipeline = Path(pipeline).resolve()
        self.backend = backend

    def control(self):
        f = self.directory / "control.json"
        return load(f) if f.exists() else {"generation": 0}

    def catalog(self):
        return [load(f) for f in sorted(self.directory.glob("v-*/manifest.json")) if load(f).get("status") == "complete"]

    def manifest(self, snapshot_id):
        if not re.fullmatch(r"v-[0-9a-f]{32}", snapshot_id):
            raise ValueError("invalid snapshot ID")
        d = self.directory / snapshot_id
        if d.is_symlink() or d.parent != self.directory:
            raise ValueError("snapshot path refused")
        m = load(d / "manifest.json")
        if m.get("status") != "complete" or m.get("id") != snapshot_id:
            raise ValueError("snapshot is incomplete")
        if (d / "database.dump").is_symlink() or digest(d / "database.dump") != m["sha256"]:
            raise ValueError("snapshot checksum mismatch")
        return m, d / "database.dump"

    @contextlib.contextmanager
    def lock(self):
        # Linux host only; tests exercise operations using a fake backend without flock.
        import fcntl
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (self.directory / ".lock").open("a") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise Deferred("another snapshot/restore operation is in progress")
            yield

    def request(self, request_file):
        f = Path(request_file).resolve()
        root = f.parent.parent.parent
        if not root.is_relative_to(self.pipeline / "workspaces") or f != root / ".slr/kb/snapshot-request.json":
            raise ValueError("request must belong to this pipeline's workspace")
        req = load(f)
        cfg = load(root / ".slr/survey-kb.json")
        rt = load(root / ".slr/kb/runtime.json")
        finish = rt.get("finishRequested", {})
        if not cfg.get("enabled") or cfg.get("snapshotGeneration", 0) != self.control()["generation"]:
            raise ValueError("workspace predates restored database or KB is disabled")
        if req.get("runId") != cfg["runId"] or req.get("batchId") != finish.get("batchId") or not req.get("batchId"):
            raise ValueError("snapshot request does not match final delivery")
        if any(req.get(key) != finish.get(key) for key in ("fingerprint", "submissionId")):
            raise ValueError("snapshot request references a different final review")
        report = load(root / ".slr/kb/last-sync.json")
        if report.get("status") not in ("complete", "complete_with_exclusions"):
            raise Deferred("run upload/distillation is not complete")
        jobs, records = set(), set()
        for path in (root / ".slr/kb/outbox").glob("*.json"):
            item = load(path)
            if item["status"] not in ("succeeded", "removed", "retained"):
                raise Deferred("run still has unfinished uploads")
            if item["status"] == "removed":
                continue
            if item.get("jobId"):
                jobs.add(item["jobId"])
            elif item.get("remoteId"):
                records.add(item["remoteId"])
            else:
                raise ValueError("successful upload has no remote receipt")
        for path in (root / ".slr/kb/feedback").glob("*.json"):
            item = load(path)
            if not item.get("jobId"):
                raise Deferred("run has unsent feedback; use kb-feedback resume")
            jobs.add(item["jobId"])
        return {**req, "workspace": str(root), "request_file": str(f), "jobIds": sorted(jobs), "recordIds": sorted(records)}

    def save(self, label, request=None, *, backup=False, operation=None):
        control = self.control()
        if control.get("pending_restore") and not backup:
            raise ValueError("restore is unfinished; resume that restore first")
        if control.get("pending_save"):
            self.backend.start(control["pending_save"]["services"])
            control.pop("pending_save")
            atomic(self.directory / "control.json", control)
        key = (str(control["generation"]) + ":" + request["runId"] + ":" + request["batchId"]) if request else ("backup:" + operation if operation else None)
        if key:
            for entry in self.catalog():
                if entry.get("run_key") == key:
                    self.manifest(entry["id"])
                    return entry
        before = self.backend.info()
        if not backup and (before["unfinished"] or before["open_transfers"]):
            raise Deferred("knowledge base has unfinished/failed tasks or partial transfers; snapshot deferred")
        if shutil.disk_usage(self.directory).free < before.get("database_bytes", 0) + 64 * 1024 * 1024:
            raise ValueError("insufficient snapshot disk space; free space must exceed database size plus 64 MiB")
        services = self.backend.services()
        stopped = False
        try:
            atomic(self.directory / "control.json", {**control, "pending_save": {"services": services, "started_at": now()}})
            stopped = True
            self.backend.stop()
            info = self.backend.info()
            if not backup and (info["unfinished"] or info["open_transfers"]):
                raise Deferred("new tasks arrived before freeze; retry after processing finishes")
            if request:
                if request.get("request_file"):
                    current_request = self.request(request["request_file"])
                    if current_request != request:
                        raise Deferred("local run receipts changed before freeze; retry snapshot")
                receipts = self.backend.receipts(request["jobIds"], request["recordIds"])
                if receipts != {"jobs": len(request["jobIds"]), "records": len(request["recordIds"])}:
                    raise Deferred("remote receipts do not confirm this run is fully saved")
            sid = "v-" + uuid.uuid4().hex
            temp = self.directory / (".partial-" + sid)
            temp.mkdir(parents=True, mode=0o700)
            self.backend.dump(temp / "database.dump")
            manifest = {"format": 1, "id": sid, "status": "complete", "label": label, "created_at": now(),
                        "generation": control["generation"], "run_key": key, "run": request,
                        "purpose": "pre_restore" if backup else "checkpoint", "database": info,
                        "sha256": digest(temp / "database.dump"), "bytes": (temp / "database.dump").stat().st_size}
            atomic(temp / "manifest.json", manifest)
            os.replace(temp, self.directory / sid)
            sync_directory(self.directory)
            return manifest
        finally:
            if stopped:
                self.backend.start(services)
                atomic(self.directory / "control.json", control)

    def restore(self, sid, confirm):
        if confirm != sid:
            raise ValueError("restore requires --confirm with the exact snapshot ID")
        target, dump = self.manifest(sid)
        control = self.control()
        if control.get("pending_save"):
            if control.get("pending_restore", {}).get("target") != sid:
                raise ValueError("snapshot save was interrupted; repeat create to recover services before restore")
            self.backend.start(control["pending_save"]["services"])
            control.pop("pending_save")
            atomic(self.directory / "control.json", control)
        current = self.backend.info()
        for key in ("schema", "pg_major", "embedding_model"):
            if current[key] != target["database"][key]:
                raise ValueError("incompatible " + key + "; align code/database/model before restoring")
        intent = control.get("pending_restore")
        if intent and intent["target"] != sid:
            raise ValueError("another restore is incomplete; resume its target")
        services = self.backend.services() if not intent else intent["services"]
        if not intent:
            intent = {"target": sid, "backup": None, "operation": uuid.uuid4().hex, "services": services, "started_at": now(), "phase": "preparing"}
            control = {**control, "pending_restore": intent}
            atomic(self.directory / "control.json", control)
        try:
            self.backend.stop()
            if not intent["backup"]:
                backup = self.save("Before restore " + sid, backup=True, operation=intent["operation"])
                intent.update({"backup": backup["id"], "phase": "applying"})
                # This counter lives outside the restored DB. Repeated recovery uses
                # the same operation/backup and only increments the counter once.
                control.update({"generation": control["generation"] + 1, "pending_restore": intent})
                atomic(self.directory / "control.json", control)
            self.backend.restore(dump)
            restored = self.backend.info()
            for key in ("papers", "experiences", "trajectories", "jobs", "revisions_hash", "trajectories_hash", "entities_hash", "sources_hash", "chunks_hash", "jobs_hash"):
                if restored[key] != target["database"][key]:
                    raise RuntimeError("restored inventory mismatch: " + key)
            self.backend.start(services)
            control.pop("pending_restore")
            control.update({"restored_snapshot": sid, "restored_at": now(), "pre_restore_snapshot": intent["backup"]})
            atomic(self.directory / "control.json", control)
            return control
        except Exception:
            # Keep API/worker stopped. Repeating the same restore resumes from the
            # original safety backup/intent and never overwrites that backup.
            with contextlib.suppress(Exception):
                self.backend.stop()
            raise RuntimeError("restore unfinished; API/worker remain stopped; rerun the same restore command")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["create", "list", "restore", "status"])
    p.add_argument("snapshot_id", nargs="?")
    p.add_argument("--confirm")
    p.add_argument("--label", default="Manual checkpoint")
    p.add_argument("--request")
    p.add_argument("--directory", default=os.environ.get("SURVEY_KB_SNAPSHOT_DIR", "/root/survey-kb/snapshots"))
    p.add_argument("--kb-dir", default=os.environ.get("KB_SOURCE_DIR", "/root/survey-kb-source/knowledge-base"))
    p.add_argument("--pipeline", default="/root/JiahaoCAO/SLRHarness_cc_plugin")
    a = p.parse_args(argv)
    try:
        manager = Snapshots(a.directory, Docker(a.kb_dir), a.pipeline)
        with manager.lock():
            if not (manager.directory / "control.json").exists():
                atomic(manager.directory / "control.json", {"generation": 0})
            if a.action == "list":
                result = {"snapshots": manager.catalog()}
            elif a.action == "status":
                result = manager.control()
            elif a.action == "restore":
                result = manager.restore(a.snapshot_id, a.confirm)
            else:
                req = manager.request(a.request) if a.request else None
                result = manager.save(a.label if not req else req.get("topic", a.label), req)
            print(json.dumps({"status": "saved" if a.action == "create" else "ok", "result": result}, ensure_ascii=False))
    except Deferred as e:
        print(json.dumps({"status": "waiting", "reason": str(e)}))
        return 3
    except Exception as e:
        print(json.dumps({"status": "failed", "reason": str(e)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
