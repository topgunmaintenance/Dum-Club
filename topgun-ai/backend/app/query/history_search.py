"""History lane — work orders, logbook, troubleshooting records."""
from __future__ import annotations

from typing import Any

from app.retrieval.vector_store import VectorStore
from app.schemas.query import QueryRequest
from app.services.ai_provider import get_ai_provider

LANE_NAME = "history"
_TYPES = ["WORK_ORDER", "LOGBOOK", "TROUBLESHOOTING"]


class HistorySearch:
    def __init__(self, store: VectorStore) -> None:
        self._store = store

    def search(self, request: QueryRequest) -> list[dict[str, Any]]:
        provider = get_ai_provider()
        [embedding] = provider.embed([request.question])
        hits = self._store.similarity_search(
            embedding=embedding, top_k=10, doc_types=_TYPES
        )
        return [
            {
                "id": chunk.id,
                "document_id": chunk.document_id,
                "document_title": chunk.metadata.get("title", chunk.document_id),
                "document_type": chunk.metadata.get("type", "UNKNOWN"),
                "page": chunk.page_start,
                "snippet": chunk.text[:280],
                "score": float(score),
                "lane": LANE_NAME,
            }
            for chunk, score in hits
        ]
