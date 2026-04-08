"""PDF parser stage.

The default implementation is a thin placeholder that reads a file from
disk and returns a single "page" containing the decoded bytes where
possible. In Phase 1 this will be replaced by a PyMuPDF-backed extractor
that emits per-page text with layout info.

The reason for shipping a real-but-tiny implementation (instead of a hard
stub) is so that unit tests can exercise the pipeline end-to-end against
a real temp file, and so that the upload endpoint meaningfully populates
``IngestionContext.pages`` even without the heavy PyMuPDF dependency.
"""
from __future__ import annotations

from app.core.logging import get_logger

log = get_logger(__name__)


class PdfParser:
    name = "pdf_parser"

    def run(self, ctx) -> None:  # noqa: ANN001 - IngestionContext (circular avoided)
        path = ctx.source_path
        if not path.exists():
            from app.ingestion.pipeline import IngestionError

            raise IngestionError(self.name, f"source file missing: {path}")

        # Try to read as text if the upload is a .txt / .md test fixture.
        if path.suffix.lower() in {".txt", ".md"}:
            text = path.read_text(errors="ignore")
            ctx.pages = _split_into_pages(text)
            log.info("pdf_parser: read %d page-chunks from %s", len(ctx.pages), path.name)
            return

        # Real PDF path: PyMuPDF not enabled in Phase 0. We record a
        # single placeholder page whose length forces OCR downstream,
        # matching the "if extractor finds no text, OCR takes over" rule.
        ctx.pages = [""]
        log.info(
            "pdf_parser: placeholder text extraction for %s — OCR fallback will run",
            path.name,
        )


def _split_into_pages(text: str, *, page_chars: int = 3000) -> list[str]:
    """Break a flat text fixture into pseudo-pages for testing."""
    if not text:
        return [""]
    return [text[i : i + page_chars] for i in range(0, len(text), page_chars)]
