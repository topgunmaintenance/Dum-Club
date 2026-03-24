"""
Embedding service using Sentence Transformers.
Model: all-MiniLM-L6-v2  →  384-dim vectors  (matches SQL schema)
"""
from sentence_transformers import SentenceTransformer
from typing import List, Optional
import numpy as np

_model: Optional[SentenceTransformer] = None
MODEL_NAME = "all-MiniLM-L6-v2"


def _load_model() -> SentenceTransformer:
    global _model
    if _model is None:
        print(f"🔢 Loading embedding model: {MODEL_NAME}")
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Return list of 384-dim float vectors."""
    model = _load_model()
    embeddings = model.encode(texts, convert_to_numpy=True, normalize_embeddings=True)
    return embeddings.tolist()


def embed_single(text: str) -> List[float]:
    return embed_texts([text])[0]


def chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> List[str]:
    """Simple sliding-window chunker."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks
