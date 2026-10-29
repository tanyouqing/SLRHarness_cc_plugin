"""Offline maintenance tests: fake database/container operations, temporary files."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("snapshot", Path(__file__).with_name("snapshot.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Fake:
    def __init__(self):
        self.state = dict(schema=["005"], pg_major=16, embedding_model=["model"], unfinished=0, open_transfers=0,
                          papers=2, experiences=3, trajectories=4, jobs=5, revisions_hash="a", trajectories_hash="b", entities_hash="c", sources_hash="s", chunks_hash="v", jobs_hash="d")
        self.running = ["api", "worker"]
        self.calls = []
        self.fail_dump = False
        self.fail_restore = False
        self.fail_start = False
        self.on_stop = None

    def info(self):
        return copy.deepcopy(self.state)

    def services(self):
        return self.running[:]

    def stop(self):
        self.calls.append("stop")
        self.running = []
        if self.on_stop:
            self.on_stop()

    def start(self, services):
        self.calls.append("start")
        if self.fail_start:
            raise RuntimeError("start failed")
        self.running = services[:]

    def dump(self, path):
        self.calls.append("dump")
        if self.fail_dump:
            raise RuntimeError("disk failure")
        Path(path).write_text(json.dumps(self.state))

    def restore(self, path):
        self.calls.append("restore")
        if self.fail_restore:
            raise RuntimeError("restore failed")
        self.state = json.loads(Path(path).read_text())

    def receipts(self, jobs, records):
        return dict(jobs=len(jobs), records=len(records))


class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.fake = Fake()
        self.manager = m.Snapshots(self.base / "snapshots", self.fake, self.base / "pipeline")
        self.manager.directory.mkdir()
        m.atomic(self.manager.directory / "control.json", {"generation": 0})

    def test_complete_snapshot_idempotent_and_checksum(self):
        req = dict(runId="run", batchId="batch", jobIds=[], recordIds=[])
        a = self.manager.save("topic", req)
        self.assertEqual(self.manager.save("topic", req)["id"], a["id"])
        self.assertEqual(self.fake.calls.count("dump"), 1)
        self.assertEqual(self.fake.running, ["api", "worker"])
        self.assertEqual(len(self.manager.catalog()), 1)
        (self.manager.directory / a["id"] / "database.dump").write_text("corrupted")
        with self.assertRaisesRegex(ValueError, "checksum"):
            self.manager.manifest(a["id"])

    def test_busy_and_arriving_jobs_defer_without_incomplete_snapshot(self):
        self.fake.state["unfinished"] = 1
        with self.assertRaises(m.Deferred):
            self.manager.save("busy")
        self.assertEqual(self.fake.calls, [])
        self.fake.state["unfinished"] = 0
        self.fake.on_stop = lambda: self.fake.state.update(unfinished=1)
        with self.assertRaises(m.Deferred):
            self.manager.save("race")
        self.assertEqual(self.fake.running, ["api", "worker"])
        self.assertEqual(self.manager.catalog(), [])

    def test_dump_failure_retains_services_and_excludes_partial(self):
        self.fake.fail_dump = True
        with self.assertRaisesRegex(RuntimeError, "disk"):
            self.manager.save("failure")
        self.assertEqual(self.manager.catalog(), [])
        self.assertEqual(self.fake.running, ["api", "worker"])

    def test_save_restart_failure_is_recoverable_without_duplicate_dump(self):
        req = dict(runId="run", batchId="batch", jobIds=[], recordIds=[])
        self.fake.fail_start = True
        with self.assertRaises(RuntimeError):
            self.manager.save("topic", req)
        self.assertIn("pending_save", self.manager.control())
        self.fake.fail_start = False
        self.manager.save("topic", req)
        self.assertEqual(self.fake.calls.count("dump"), 1)
        self.assertEqual(self.fake.running, ["api", "worker"])

    def test_restore_keeps_original_backup_and_monotonic_generation(self):
        a = self.manager.save("baseline")
        self.fake.state.update(experiences=9, entities_hash="new")
        result = self.manager.restore(a["id"], a["id"])
        self.assertEqual(self.fake.state["experiences"], 3)
        self.assertEqual(result["generation"], 1)
        backup, _ = self.manager.manifest(result["pre_restore_snapshot"])
        self.assertEqual(backup["database"]["experiences"], 9)
        self.assertEqual(self.fake.running, ["api", "worker"])

    def test_restore_failure_resumes_same_intent_without_overwriting_backup(self):
        a = self.manager.save("baseline")
        self.fake.state["experiences"] = 9
        self.fake.fail_restore = True
        with self.assertRaisesRegex(RuntimeError, "unfinished"):
            self.manager.restore(a["id"], a["id"])
        intent = self.manager.control()["pending_restore"]
        self.assertEqual(self.fake.running, [])
        with self.assertRaises(ValueError):
            self.manager.save("not allowed")
        self.fake.fail_restore = False
        result = self.manager.restore(a["id"], a["id"])
        self.assertEqual(result["pre_restore_snapshot"], intent["backup"])
        self.assertEqual(result["generation"], 1)
        self.assertEqual(self.fake.calls.count("dump"), 2)

    def test_incompatible_schema_and_confirmation_do_not_stop_services(self):
        a = self.manager.save("baseline")
        self.fake.calls.clear()
        with self.assertRaises(ValueError):
            self.manager.restore(a["id"], "yes")
        self.fake.state["schema"].append("006")
        with self.assertRaisesRegex(ValueError, "incompatible"):
            self.manager.restore(a["id"], a["id"])
        self.assertEqual(self.fake.calls, [])

    def test_crash_after_safety_dump_before_intent_receipt_reuses_original_backup(self):
        a = self.manager.save("baseline")
        self.fake.state["experiences"] = 9
        original = self.manager.save
        def crash(*args, **kwargs):
            result = original(*args, **kwargs)
            if kwargs.get("backup"):
                raise RuntimeError("process interrupted before saving receipt")
            return result
        self.manager.save = crash
        with self.assertRaises(RuntimeError):
            self.manager.restore(a["id"], a["id"])
        self.assertEqual(self.manager.control()["pending_restore"]["phase"], "preparing")
        self.manager.save = original
        result = self.manager.restore(a["id"], a["id"])
        self.assertEqual(self.fake.calls.count("dump"), 2)
        self.assertEqual(result["generation"], 1)
        backup, _ = self.manager.manifest(result["pre_restore_snapshot"])
        self.assertEqual(backup["database"]["experiences"], 9)

    def test_request_validates_outbox_feedback_generation_and_server_receipts(self):
        root = self.manager.pipeline / "workspaces/topic"
        f = root / ".slr/kb/snapshot-request.json"
        m.atomic(f, dict(runId="run", batchId="batch"))
        m.atomic(root / ".slr/survey-kb.json", dict(enabled=True, runId="run"))
        m.atomic(root / ".slr/kb/runtime.json", dict(finishRequested=dict(batchId="batch")))
        m.atomic(root / ".slr/kb/last-sync.json", dict(status="complete"))
        m.atomic(root / ".slr/kb/outbox/item.json", dict(status="succeeded", jobId="job"))
        req = self.manager.request(f)
        self.assertEqual(req["jobIds"], ["job"])
        self.fake.receipts = lambda *_: dict(jobs=0, records=0)
        with self.assertRaisesRegex(m.Deferred, "receipts"):
            self.manager.save("topic", req)
        m.atomic(root / ".slr/kb/feedback/item.json", dict(status="pending"))
        with self.assertRaisesRegex(m.Deferred, "unsent feedback"):
            self.manager.request(f)
        m.atomic(self.manager.directory / "control.json", dict(generation=1))
        with self.assertRaisesRegex(ValueError, "predates"):
            self.manager.request(f)

    def test_changed_local_receipts_before_freeze_defer_snapshot(self):
        root = self.manager.pipeline / "workspaces/topic"
        f = root / ".slr/kb/snapshot-request.json"
        m.atomic(f, dict(runId="run", batchId="batch"))
        m.atomic(root / ".slr/survey-kb.json", dict(enabled=True, runId="run"))
        m.atomic(root / ".slr/kb/runtime.json", dict(finishRequested=dict(batchId="batch")))
        m.atomic(root / ".slr/kb/last-sync.json", dict(status="complete"))
        req = self.manager.request(f)
        self.fake.on_stop = lambda: m.atomic(root / ".slr/kb/outbox/new.json", dict(status="pending"))
        with self.assertRaisesRegex(m.Deferred, "unfinished uploads"):
            self.manager.save("topic", req)
        self.assertEqual(self.manager.catalog(), [])
        self.assertEqual(self.fake.running, ["api", "worker"])

    def test_restored_inventory_mismatch_keeps_services_stopped_and_intent(self):
        a = self.manager.save("baseline")
        restore = self.fake.restore
        def corrupt(path):
            restore(path)
            self.fake.state["chunks_hash"] = "corrupted"
        self.fake.restore = corrupt
        with self.assertRaisesRegex(RuntimeError, "unfinished"):
            self.manager.restore(a["id"], a["id"])
        self.assertEqual(self.fake.running, [])
        self.assertEqual(self.manager.control()["pending_restore"]["target"], a["id"])
        self.fake.restore = restore
        self.manager.restore(a["id"], a["id"])
        self.assertEqual(self.fake.calls.count("dump"), 2)


if __name__ == "__main__":
    unittest.main()
