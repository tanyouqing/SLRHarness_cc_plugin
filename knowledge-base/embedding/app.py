import os
import threading
from contextlib import asynccontextmanager
import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from chunking import prepare_chunks, windows

MODEL_PATH = os.environ.get("MODEL_PATH", "/models/bge-m3")
MODEL_VERSION = "BAAI/bge-m3@" + os.environ.get("MODEL_REVISION", "5617a9f")
LIMIT = int(os.environ.get("CHUNK_TOKENS", "768"))
OVERLAP = int(os.environ.get("CHUNK_OVERLAP", "64"))
torch.set_num_threads(int(os.environ.get("EMBEDDING_THREADS", "4")))
torch.set_num_interop_threads(1)
condition = threading.Condition()
busy = False
waiting_queries = 0
model = None


@asynccontextmanager
async def lifespan(app):
    global model
    model = SentenceTransformer(MODEL_PATH, device="cpu", local_files_only=True)
    model.max_seq_length = LIMIT
    model.float()
    if model.get_sentence_embedding_dimension() != 1024:
        raise RuntimeError("expected 1024-dimensional BGE-M3")
    yield


app = FastAPI(lifespan=lifespan)


class Query(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class Prepare(BaseModel):
    kind: str
    payload: dict


def encode(texts, priority=False):
    global busy, waiting_queries
    if any(len(model.tokenizer.encode(t)) > LIMIT for t in texts):
        raise HTTPException(422, "chunk exceeds configured token limit")
    result = []
    # Yield between chunks so a queued interactive query can overtake bulk indexing.
    for text in texts:
        with condition:
            if priority:
                waiting_queries += 1
            while busy or (not priority and waiting_queries):
                condition.wait()
            if priority:
                waiting_queries -= 1
            busy = True
        try:
            with torch.inference_mode():
                result.append(model.encode([text], batch_size=1, normalize_embeddings=True, show_progress_bar=False)[0])
        finally:
            with condition:
                busy = False
                condition.notify_all()
    return np.array(result)


@app.get("/healthz")
def health():
    return {"ready": model is not None, "model_version": MODEL_VERSION, "dimension": 1024}


@app.post("/query")
def query(req: Query):
    parts = windows(req.text, model.tokenizer, LIMIT, 0)
    if not parts:
        raise HTTPException(422, "query has no tokens")
    vectors = encode([p["text"] for p in parts], priority=True)
    vector = np.mean(vectors, axis=0)
    norm = np.linalg.norm(vector)
    if not norm:
        raise HTTPException(500, "zero embedding")
    return {"embedding": (vector / norm).tolist(), "model_version": MODEL_VERSION}


@app.post("/prepare")
def prepare(req: Prepare):
    if req.kind not in ["paper", "experience"]:
        raise HTTPException(422, "invalid kind")
    chunks = prepare_chunks(req.kind, req.payload, model.tokenizer, LIMIT, OVERLAP)
    if not chunks:
        raise HTTPException(422, "no indexable content")
    vectors = encode([c["text"] for c in chunks])
    return {"chunks": [{**c, "embedding": v.tolist()} for c, v in zip(chunks, vectors)], "model_version": MODEL_VERSION}
