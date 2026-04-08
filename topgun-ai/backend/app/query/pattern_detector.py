"""Pattern lane — recurring fault clusters.

Phase 3 will cluster past write-ups on text + ATA + aircraft type and
return cluster hits. The MVP returns an empty list so the rank fuser has
a stable four-lane input.
"""
from __future__ import annotations

from typing import Any

from app.retrieval.vector_store import VectorStore
from app.schemas.query import QueryRequest

LANE_NAME = "pattern"


class PatternDetector:
    def __init__(self, store: VectorStore) -> None:
        self._store = store

    def search(self, request: QueryRequest) -> list[dict[str, Any]]:  # noqa: ARG002
        return []
