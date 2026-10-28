from pathlib import Path
import tarfile
import hashlib

root = Path(__file__).resolve().parent.parent
target = root.parent / "knowledge-base-release.tar.gz"
excluded_dirs = {"node_modules", "dist", ".npm-cache", "reports", "backups", "models", "__pycache__", ".git"}
excluded_files = {".env", "config/models.json", "config/agents.json", "config/auth.json", "config/models-store.json"}
with tarfile.open(target, "w:gz") as archive:
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if path.is_symlink() or any(part in excluded_dirs for part in rel.parts) or rel.as_posix() in excluded_files:
            continue
        if path.is_file():
            archive.add(path, arcname="knowledge-base/" + rel.as_posix(), recursive=False)
digest = hashlib.sha256(target.read_bytes()).hexdigest()
target.with_suffix(target.suffix + ".sha256").write_text(digest + "  " + target.name + "\n", encoding="utf-8")
print(f"Release: {target}\nSHA256: {digest}")
