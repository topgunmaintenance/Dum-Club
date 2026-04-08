"""Small text utilities used across ingestion and query."""
from __future__ import annotations

import re

_WS = re.compile(r"\s+")


def normalize_whitespace(text: str) -> str:
    return _WS.sub(" ", text).strip()


def truncate(text: str, max_len: int, *, suffix: str = "…") -> str:
    if len(text) <= max_len:
        return text
    return text[: max_len - len(suffix)].rstrip() + suffix
