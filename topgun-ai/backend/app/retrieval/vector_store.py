"""Pluggable vector store interface.

The MVP ships a tiny in-memory implementation so the end-to-end flow
(ingestion → retrieval → query) works without Postgres. Phase 1 adds a
pgvector-backed implementation with the same surface area.
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class StoredChunk:
    id: str
    document_id: str
    text: str
    page_start: int
    page_end: int
    position: int
    embedding: list[float]
    metadata: dict[str, Any] = field(default_factory=dict)


class VectorStore(Protocol):
    def upsert(
        self,
        *,
        document_id: str,
        chunks: list[dict[str, Any]],
        embeddings: list[list[float]],
        metadata: dict[str, Any],
    ) -> None: ...

    def similarity_search(
        self,
        *,
        embedding: list[float],
        top_k: int = 10,
        doc_types: list[str] | None = None,
    ) -> list[tuple[StoredChunk, float]]: ...


# ---------------------------------------------------------------------------
class MemoryVectorStore:
    """Thread-safe, in-process vector store. Cosine similarity."""

    def __init__(self) -> None:
        self._chunks: dict[str, StoredChunk] = {}
        self._lock = threading.Lock()

    def upsert(
        self,
        *,
        document_id: str,
        chunks: list[dict[str, Any]],
        embeddings: list[list[float]],
        metadata: dict[str, Any],
    ) -> None:
        with self._lock:
            # Drop any prior chunks for the same document.
            self._chunks = {
                cid: c for cid, c in self._chunks.items() if c.document_id != document_id
            }
            for chunk, vec in zip(chunks, embeddings):
                stored = StoredChunk(
                    id=chunk["id"],
                    document_id=document_id,
                    text=chunk["text"],
                    page_start=chunk["page_start"],
                    page_end=chunk["page_end"],
                    position=chunk["position"],
                    embedding=vec,
                    metadata=dict(metadata),
                )
                self._chunks[stored.id] = stored

    def similarity_search(
        self,
        *,
        embedding: list[float],
        top_k: int = 10,
        doc_types: list[str] | None = None,
    ) -> list[tuple[StoredChunk, float]]:
        with self._lock:
            candidates = list(self._chunks.values())
        if doc_types:
            allowed = set(doc_types)
            candidates = [c for c in candidates if c.metadata.get("type") in allowed]

        scored = [
            (c, _cosine(c.embedding, embedding)) for c in candidates if c.embedding
        ]
        scored.sort(key=lambda pair: pair[1], reverse=True)
        return scored[:top_k]


# ---------------------------------------------------------------------------
def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


_store: VectorStore | None = None


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        _store = MemoryVectorStore()
    return _store
