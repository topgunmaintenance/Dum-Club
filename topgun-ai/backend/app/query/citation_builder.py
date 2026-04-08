"""Citation builder.

Transforms fused chunk hits into the ``Citation`` shape the query
response uses. Keeping this as its own tiny module makes it easy to add
deep-link URLs, quality flags, and source-drawer metadata later.
"""
from __future__ import annotations

from typing import Any


def build_citations(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for chunk in chunks:
        citations.append(
            {
                "document_id": chunk["document_id"],
                "document_title": chunk.get("document_title", chunk["document_id"]),
                "document_type": chunk.get("document_type", "UNKNOWN"),
                "page": int(chunk.get("page", 1)),
                "snippet": chunk.get("snippet", ""),
                "score": float(chunk.get("score", 0.0)),
                "lane": _primary_lane(chunk),
            }
        )
    return citations


def _primary_lane(chunk: dict[str, Any]) -> str:
    lanes = chunk.get("lanes")
    if lanes:
        return lanes[0]
    return chunk.get("lane", "manual")
