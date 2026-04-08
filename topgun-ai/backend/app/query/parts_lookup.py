"""Parts lane — parts catalog + parts lifecycle events."""
from __future__ import annotations

from typing import Any

from app.retrieval.vector_store import VectorStore
from app.schemas.query import QueryRequest

LANE_NAME = "parts"


class PartsLookup:
    """MVP placeholder.

    Phase 2 will combine a parts-table lookup with the parts_catalog
    vector lane. For now we return an empty lane so the fusion step has
    a stable shape.
    """

    def __init__(self, store: VectorStore) -> None:
        self._store = store

    def search(self, request: QueryRequest) -> list[dict[str, Any]]:  # noqa: ARG002
        return []
