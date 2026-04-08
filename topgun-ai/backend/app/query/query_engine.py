"""4-lane query engine.

Responsibilities:

1. Route a question in parallel through the four lanes:
   manual_search, history_search, parts_lookup, pattern_detector.
2. Merge lane hits with rank fusion.
3. Hand the merged set + question to ``answer_formatter`` for synthesis.
4. Attach chunk-level citations.

In demo mode, the engine short-circuits to the seeded query store: if the
question is close enough to one of the sample queries, the engine returns
it verbatim. Any unmatched question falls through to a real lane sweep
that currently returns an "insufficient evidence" response — this is the
exact behavior we want, because the MVP must never hallucinate.
"""
from __future__ import annotations

from typing import Any

from app.core.demo_store import DemoStore
from app.core.logging import get_logger
from app.query.answer_formatter import AnswerFormatter
from app.query.citation_builder import build_citations
from app.query.history_search import HistorySearch
from app.query.manual_search import ManualSearch
from app.query.parts_lookup import PartsLookup
from app.query.pattern_detector import PatternDetector
from app.retrieval.ranker import reciprocal_rank_fusion
from app.retrieval.vector_store import VectorStore, get_vector_store
from app.schemas.query import QueryRequest

log = get_logger(__name__)


LANE_WEIGHTS = {
    "manual": 1.3,
    "history": 1.0,
    "parts": 0.9,
    "pattern": 0.7,
}


class QueryEngine:
    def __init__(
        self,
        *,
        demo_store: DemoStore,
        vector_store: VectorStore,
        manual: ManualSearch,
        history: HistorySearch,
        parts: PartsLookup,
        pattern: PatternDetector,
        formatter: AnswerFormatter,
    ) -> None:
        self._demo_store = demo_store
        self._vector_store = vector_store
        self._manual = manual
        self._history = history
        self._parts = parts
        self._pattern = pattern
        self._formatter = formatter

    # ------------------------------------------------------------------
    @classmethod
    def default(cls, demo_store: DemoStore) -> "QueryEngine":
        store = get_vector_store()
        return cls(
            demo_store=demo_store,
            vector_store=store,
            manual=ManualSearch(store),
            history=HistorySearch(store),
            parts=PartsLookup(store),
            pattern=PatternDetector(store),
            formatter=AnswerFormatter(),
        )

    # ------------------------------------------------------------------
    def handle(self, request: QueryRequest) -> dict[str, Any]:
        # 1. Demo fast path — the seeded store holds fully formed answers.
        demo_hit = self._demo_store.find_query(request.question)
        if demo_hit:
            log.info("query_engine: demo-store hit for %r", request.question[:60])
            return self._from_demo(demo_hit)

        # 2. Real lanes
        lanes = {
            "manual": self._manual.search(request),
            "history": self._history.search(request),
            "parts": self._parts.search(request),
            "pattern": self._pattern.search(request),
        }
        fused = reciprocal_rank_fusion(lanes, weights=LANE_WEIGHTS)

        # 3. Synthesize. With the stub provider and no indexed docs this
        # returns an "insufficient evidence" response — which is exactly
        # what we want in MVP for anything the demo store doesn't cover.
        synthesized = self._formatter.format(question=request.question, chunks=fused)
        synthesized["citations"] = build_citations(fused[: request.max_citations])
        return synthesized

    # ------------------------------------------------------------------
    def _from_demo(self, demo_hit: dict[str, Any]) -> dict[str, Any]:
        return {
            "answer": demo_hit["answer"],
            "sections": demo_hit.get("sections", []),
            "citations": demo_hit.get("citations", []),
            "related_documents": demo_hit.get("related_documents", []),
            "entities": demo_hit.get("entities", []),
            "confidence": demo_hit.get(
                "confidence",
                {
                    "score": 0.7,
                    "label": "medium",
                    "reason": "Demo store match.",
                },
            ),
            "followups": demo_hit.get("followups", []),
        }
