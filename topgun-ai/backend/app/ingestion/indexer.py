"""Indexer stage.

Writes the document, its chunks, and the chunk embeddings into the
vector store. The MVP uses an in-memory store (``retrieval.vector_store``);
Phase 1 swaps in a Postgres + pgvector implementation with the same
interface.
"""
from __future__ import annotations

from app.core.logging import get_logger
from app.retrieval.vector_store import get_vector_store

log = get_logger(__name__)


class Indexer:
    name = "indexer"

    def run(self, ctx) -> None:  # noqa: ANN001
        store = get_vector_store()
        store.upsert(
            document_id=ctx.doc_id,
            chunks=ctx.chunks,
            embeddings=ctx.embeddings,
            metadata={
                "title": ctx.title,
                "type": ctx.classified_type,
                "aircraft": ctx.aircraft,
                "source": ctx.source,
            },
        )
        ctx.indexed = True
        log.info("indexer: indexed %d chunks for %s", len(ctx.chunks), ctx.doc_id)
