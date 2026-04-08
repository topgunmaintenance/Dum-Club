"""Embedder stage.

Delegates to the configured ``AIProvider`` to compute one vector per
chunk. Stores the vectors on the ingestion context so the indexer can
persist them in the next stage.
"""
from __future__ import annotations

from app.core.logging import get_logger
from app.services.ai_provider import get_ai_provider

log = get_logger(__name__)


class Embedder:
    name = "embedder"

    def run(self, ctx) -> None:  # noqa: ANN001
        if not ctx.chunks:
            log.info("embedder: nothing to embed")
            ctx.embeddings = []
            return

        provider = get_ai_provider()
        texts = [c["text"] for c in ctx.chunks]
        vectors = provider.embed(texts)
        if len(vectors) != len(texts):
            from app.ingestion.pipeline import IngestionError

            raise IngestionError(
                self.name, f"provider returned {len(vectors)} vectors for {len(texts)} chunks"
            )
        ctx.embeddings = vectors
        log.info("embedder: produced %d vectors via %s", len(vectors), provider.name)
