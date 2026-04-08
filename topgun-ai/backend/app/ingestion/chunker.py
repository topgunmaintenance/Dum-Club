"""Chunker stage.

Splits page text into overlapping chunks that respect page boundaries
and carry provenance (page anchors and character offsets) for the Source
Drawer. The default target is 800 "tokens" (approximated as 4 chars per
token) with 120-token overlap, matching the defaults in
``docs/ingestion-pipeline.md``.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class ChunkerConfig:
    target_tokens: int = 800
    overlap_tokens: int = 120
    chars_per_token: int = 4

    @property
    def target_chars(self) -> int:
        return self.target_tokens * self.chars_per_token

    @property
    def overlap_chars(self) -> int:
        return self.overlap_tokens * self.chars_per_token


class Chunker:
    name = "chunker"

    def __init__(self, config: ChunkerConfig | None = None) -> None:
        self.config = config or ChunkerConfig()

    def run(self, ctx) -> None:  # noqa: ANN001
        chunks: list[dict] = []
        for page_index, page_text in enumerate(ctx.pages, start=1):
            for position, text in enumerate(self._split_page(page_text)):
                chunks.append(
                    {
                        "id": f"{ctx.doc_id}_p{page_index}_c{position}",
                        "document_id": ctx.doc_id,
                        "page_start": page_index,
                        "page_end": page_index,
                        "position": position,
                        "text": text,
                    }
                )
        ctx.chunks = chunks
        log.info(
            "chunker: produced %d chunks from %d pages", len(chunks), len(ctx.pages)
        )

    # ------------------------------------------------------------------
    def _split_page(self, text: str) -> list[str]:
        if not text:
            return []
        target = self.config.target_chars
        overlap = self.config.overlap_chars
        if len(text) <= target:
            return [text]
        out: list[str] = []
        start = 0
        while start < len(text):
            end = min(start + target, len(text))
            out.append(text[start:end])
            if end == len(text):
                break
            start = end - overlap
        return out
