"""Field extractor stage.

Extracts structured fields (tail number, ATA chapter, part numbers,
dates) from the parsed text. The stub uses regex heuristics; Phase 2
replaces the heavy lifting with an Anthropic structured-extraction call.
"""
from __future__ import annotations

import re

from app.core.logging import get_logger

log = get_logger(__name__)

_TAIL_RE = re.compile(r"\bN[0-9]{1,5}[A-Z]{0,2}\b")
_ATA_RE = re.compile(r"\bATA\s?(\d{2})\b", re.IGNORECASE)
_PN_RE = re.compile(r"\b[0-9]{3,}-[0-9A-Z]{2,}(?:-[0-9A-Z]+)?\b")
_DATE_RE = re.compile(r"\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b")


class FieldExtractor:
    name = "field_extractor"

    def run(self, ctx) -> None:  # noqa: ANN001
        text = "\n".join(ctx.pages)
        tail_numbers = sorted(set(_TAIL_RE.findall(text)))
        ata_chapters = sorted({m.group(1) for m in _ATA_RE.finditer(text)})
        part_numbers = sorted(set(_PN_RE.findall(text)))
        dates = sorted({"-".join(m.groups()) for m in _DATE_RE.finditer(text)})

        ctx.extracted_fields.update(
            {
                "tail_numbers": tail_numbers,
                "ata_chapters": ata_chapters,
                "part_numbers": part_numbers[:50],
                "dates": dates,
            }
        )
        log.info(
            "field_extractor: tails=%d ata=%d parts=%d dates=%d",
            len(tail_numbers),
            len(ata_chapters),
            len(part_numbers),
            len(dates),
        )
