"""Create local deployment configuration without overwriting existing files."""
from pathlib import Path
import secrets
import shutil

root = Path(__file__).resolve().parent.parent
env = root / ".env"
if not env.exists():
    text = (root / ".env.example").read_text(encoding="utf-8")
    text = text.replace("REPLACE_WITH_32_RANDOM_HEX_CHARACTERS", secrets.token_hex(16))
    text = text.replace("REPLACE_WITH_64_RANDOM_HEX_CHARACTERS", secrets.token_hex(32))
    env.write_text(text, encoding="utf-8")
    env.chmod(0o600)
for name in ["models", "agents", "auth"]:
    target = root / "config" / f"{name}.json"
    if not target.exists():
        shutil.copyfile(root / "config" / f"{name}.example.json", target)
for directory in ["reports", "backups"]:
    (root / directory).mkdir(exist_ok=True)
print("Configuration files prepared. Edit .env, config/models.json and config/agents.json before starting.")
