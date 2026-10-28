import os
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="BAAI/bge-m3", revision=os.environ.get("MODEL_REVISION", "5617a9f"),
    local_dir=os.environ.get("MODEL_PATH", "/models/bge-m3"),
    ignore_patterns=["onnx/*", "imgs/*", "*.jpg", "colbert_linear.pt", "sparse_linear.pt"],
)
print("BGE-M3 model files are ready.")
