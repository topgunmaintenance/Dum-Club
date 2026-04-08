"""In-memory demo store seeded from ``sample_data/``.

This module keeps the MVP fully runnable without Postgres, object storage,
or any external AI provider. Everything that persists in production
(documents, chunks, queries, insights) has a read path here.

It is *not* a database replacement. The real data layer will live in
``retrieval/`` and a future ``storage/`` package once Postgres + pgvector
are wired in.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class DemoStore:
    documents: list[dict[str, Any]] = field(default_factory=list)
    queries: list[dict[str, Any]] = field(default_factory=list)
    insights: dict[str, Any] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    # ------------------------------------------------------------------
    def load(self, sample_dir: Path) -> None:
        with self._lock:
            self.documents = _read_json(sample_dir / "documents.json", default=[])
            self.queries = _read_json(sample_dir / "queries.json", default=[])
            self.insights = _read_json(sample_dir / "insights.json", default={})
        log.info(
            "demo store loaded (%d documents, %d queries, %d clusters)",
            len(self.documents),
            len(self.queries),
            len(self.insights.get("recurring_clusters", [])),
        )

    # ------------------------------------------------------------------
    # Documents
    # ------------------------------------------------------------------
    def list_documents(
        self,
        *,
        q: str | None = None,
        doc_type: str | None = None,
        aircraft: str | None = None,
    ) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self.documents)
        if q:
            needle = q.lower()
            items = [
                d
                for d in items
                if needle in d["title"].lower()
                or needle in (d.get("summary") or "").lower()
            ]
        if doc_type:
            items = [d for d in items if d["type"] == doc_type]
        if aircraft:
            items = [d for d in items if d["aircraft"] == aircraft]
        return items

    def get_document(self, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            for d in self.documents:
                if d["id"] == doc_id:
                    return dict(d)
        return None

    def add_document(self, doc: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self.documents.insert(0, doc)
        return doc

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------
    def list_recent_queries(self, limit: int = 5) -> list[dict[str, Any]]:
        with self._lock:
            return list(self.queries[:limit])

    def find_query(self, question: str) -> dict[str, Any] | None:
        """Heuristic lookup so the query workspace always has something to show.

        The match is intentionally loose: any keyword from the seeded query
        that appears in the incoming question counts as a hit. This is the
        demo equivalent of retrieval.
        """
        needle = question.lower().strip()
        if not needle:
            return None
        with self._lock:
            for q in self.queries:
                if any(tok in needle for tok in _tokens(q["question"])):
                    return dict(q)
        return None

    # ------------------------------------------------------------------
    # Insights
    # ------------------------------------------------------------------
    def get_insights(self) -> dict[str, Any]:
        with self._lock:
            return dict(self.insights)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        log.warning("demo file missing: %s", path)
        return default
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        log.error("demo file is not valid JSON: %s (%s)", path, exc)
        return default


_STOPWORDS = {
    "what",
    "when",
    "where",
    "which",
    "how",
    "the",
    "and",
    "for",
    "with",
    "show",
    "are",
    "is",
    "on",
    "of",
    "in",
    "to",
    "a",
    "an",
    "find",
    "related",
    "across",
    "fleet",
}


def _tokens(text: str) -> list[str]:
    return [
        t
        for t in "".join(c if c.isalnum() else " " for c in text.lower()).split()
        if t not in _STOPWORDS and len(t) > 2
    ]


_store: DemoStore | None = None


def get_demo_store() -> DemoStore:
    """Return the process-wide demo store, loading it on first access."""
    global _store
    if _store is None:
        store = DemoStore()
        store.load(get_settings().sample_data_dir)
        _store = store
    return _store
