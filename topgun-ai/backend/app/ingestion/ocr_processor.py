"""OCR fallback stage.

Stubbed implementation. Phase 1 will invoke pytesseract on rasterized
pages that the primary PDF parser could not extract text from. The stub
marks the pages as "OCR-empty" so downstream chunks carry the correct
quality flag.
"""
from __future__ import annotations

from app.core.logging import get_logger

log = get_logger(__name__)


class OcrProcessor:
    name = "ocr_processor"

    def run(self, ctx) -> None:  # noqa: ANN001
        log.info("ocr_processor: stub run (no pages to OCR in Phase 0)")
        ctx.extracted_fields.setdefault("ocr_applied", False)
