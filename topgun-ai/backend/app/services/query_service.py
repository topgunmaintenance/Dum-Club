"""Business logic for the query workspace."""
from __future__ import annotations

import time
from typing import Any

from app.core.demo_store import DemoStore, get_demo_store
from app.query.query_engine import QueryEngine
from app.schemas.common import ConfidenceReport, DocRef
from app.schemas.query import (
    AnswerSection,
    Citation,
    ExtractedEntity,
    QueryRequest,
    QueryResponse,
)


class QueryService:
    def __init__(self, store: DemoStore, engine: QueryEngine) -> None:
        self._store = store
        self._engine = engine

    # ------------------------------------------------------------------
    def ask(self, request: QueryRequest) -> QueryResponse:
        start = time.perf_counter()
        result = self._engine.handle(request)
        latency_ms = int((time.perf_counter() - start) * 1000)

        return QueryResponse(
            question=request.question,
            answer=result["answer"],
            sections=[AnswerSection(**s) for s in result.get("sections", [])],
            citations=[
                Citation(**c)
                for c in result.get("citations", [])[: request.max_citations]
            ],
            related_documents=[DocRef(**d) for d in result.get("related_documents", [])],
            entities=[ExtractedEntity(**e) for e in result.get("entities", [])],
            confidence=ConfidenceReport(**result["confidence"]),
            followups=list(result.get("followups", [])),
            latency_ms=latency_ms,
        )

    # ------------------------------------------------------------------
    def recent(self, *, limit: int) -> list[dict[str, Any]]:
        records = self._store.list_recent_queries(limit=limit)
        return [
            {
                "id": r["id"],
                "question": r["question"],
                "created_at": r.get("created_at"),
                "confidence": r.get("confidence", {}).get("label", "medium"),
            }
            for r in records
        ]


# ---------------------------------------------------------------------------
def get_query_service() -> QueryService:
    store = get_demo_store()
    return QueryService(store=store, engine=QueryEngine.default(store))
