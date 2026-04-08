"""Rank-fusion utilities.

Merges the results of multiple retrieval lanes using reciprocal rank
fusion with per-lane weights, then returns a single ordered list.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any


LaneHits = dict[str, list[dict[str, Any]]]


def reciprocal_rank_fusion(lanes: LaneHits, *, k: int = 60, weights: dict[str, float] | None = None) -> list[dict[str, Any]]:
    """Return chunks merged across lanes, ordered by fused score.

    Each lane contributes a ranked list of chunks. Every chunk gets a
    score of ``weight / (k + rank)`` per lane it appears in; scores are
    summed and the final list is sorted.
    """
    weights = weights or {}
    buckets: dict[str, dict[str, Any]] = {}

    for lane, hits in lanes.items():
        weight = weights.get(lane, 1.0)
        for rank, hit in enumerate(hits, start=1):
            key = _key(hit)
            bucket = buckets.setdefault(
                key,
                {**hit, "lanes": set(), "score": 0.0},
            )
            bucket["lanes"].add(lane)
            bucket["score"] += weight / (k + rank)

    merged = list(buckets.values())
    merged.sort(key=lambda h: h["score"], reverse=True)
    for m in merged:
        m["lanes"] = sorted(m["lanes"])
    return merged


def _key(hit: dict[str, Any]) -> str:
    return hit.get("id") or f'{hit.get("document_id")}:{hit.get("page")}'
