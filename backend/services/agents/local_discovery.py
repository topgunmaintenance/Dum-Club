"""
Local Discovery Agent — Agent 1 of the Off-Platform → On-Platform Growth Engine.

Responsibility
    Interpret a user search query, return DUM Club project matches AND nearby
    off-platform businesses as a single structured result packet the caller
    can render with clear labels ("On DUM Club" vs "Nearby / Not on DUM Club yet").

Design rules
    - Thin. Reuses existing helpers (_search_helpers) and the existing
      `services.external_places.search_nearby` adapter. Does not reimplement
      scoring or place lookup.
    - Deterministic. No LLM, no OCR, no randomness.
    - Injectable. Supabase client and places provider are passed in so tests
      can mock them without touching the network.
    - Additive. The existing `api/routes/search.py::/homepage` response
      contract is preserved; this agent returns a richer packet that the
      route can map back to the stable response shape.

Input payload
    {
        "query": str,              # raw user query, e.g. "pizza near me in Newark"
        "city": str,               # optional explicit city override
        "latitude": float | None,  # optional geolocation hint
        "longitude": float | None, # optional geolocation hint
        "limit": int,              # max DUM Club matches to return (default 3)
        "external_limit": int,     # max external matches to return (default 5)
    }

Output (AgentResult.data)
    {
        "query": str,              # normalised query
        "city": str,
        "words": list[str],
        "local_intent": bool,
        "on_dum_club": [            # ranked DUM Club matches
            {
                "project": {"id", "title", "description", "category"},
                "offer":   {"title","price_usd","sold","label","reason"} | None,
                "all_offers": [ ... ],
                "explanation": str,
                "score": float,
                "source": "dum_club",
                "on_dum_club": True,
                "confidence": float,        # == score, clamped 0..1
                "reason_for_match": str,    # e.g. "title contains 'pizza'"
                "claimable": False,
            },
            ...
        ],
        "nearby_off_platform": [    # ranked external candidates
            {
                "external_business_id": str,   # empty if persist failed
                "external_source": str,
                "external_place_id": str,
                "name": str,
                "address": str,
                "city": str,
                "category": str,
                "rating": float | None,
                "review_count": int,
                "phone": str,
                "website": str,
                "source": "google_places" | ...,
                "on_dum_club": False,
                "confidence": float,            # derived from rating/review_count
                "reason_for_match": str,
                "claimable": True,
            },
            ...
        ],
    }
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Optional

from services.agents.base import AgentResult, BaseAgent
from services.agents._search_helpers import (
    extract_query_words,
    has_local_intent,
    normalise_query,
    pick_best_offer,
    score_project,
)


# Type alias for the injected external places provider. Matches the
# signature of services.external_places.search_nearby.
PlacesProvider = Callable[..., Awaitable[list[Any]]]


class LocalDiscoveryAgent(BaseAgent):
    """Agent 1 — merges DUM Club + nearby off-platform search results."""

    name = "local_discovery"

    def __init__(
        self,
        supabase: Any,
        places_provider: PlacesProvider,
        fallback_threshold: float = 0.3,
    ) -> None:
        """
        Args:
            supabase: Supabase client (sync). Provided by caller so tests can mock.
            places_provider: async callable matching
                services.external_places.search_nearby. Provided so tests can
                swap in a fake with no network.
            fallback_threshold: score below which DUM Club matches are
                considered "weak" (used for the legacy `fallback_needed`
                response flag, not to gate external results).
        """
        super().__init__()
        self._sb = supabase
        self._places = places_provider
        self._fallback_threshold = fallback_threshold

    # ── Public API ──────────────────────────────────────────────────────

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        raw_query: str = (payload.get("query") or "").strip()
        explicit_city: str = payload.get("city") or ""
        lat: Optional[float] = payload.get("latitude")
        lng: Optional[float] = payload.get("longitude")
        limit: int = int(payload.get("limit") or 3)
        external_limit: int = int(payload.get("external_limit") or 5)

        if not raw_query:
            self.log("empty query")
            return AgentResult(
                status="empty",
                data={"reason": "empty_query"},
                reason="empty_query",
                logs=self._drain_logs(),
            )

        normalised, extracted_city = normalise_query(raw_query)
        city = explicit_city or extracted_city
        words = extract_query_words(normalised)
        local_intent = has_local_intent(raw_query) or bool(city)

        if not words:
            self.log(f"no valid words in query={normalised!r}")
            return AgentResult(
                status="empty",
                data={
                    "reason": "no_valid_words",
                    "query": normalised,
                    "city": city,
                    "words": [],
                    "local_intent": local_intent,
                    "on_dum_club": [],
                    "nearby_off_platform": [],
                },
                reason="no_valid_words",
                logs=self._drain_logs(),
            )

        # Parallelise DUM Club search and external search when local intent is
        # present. External search is always attempted under local intent —
        # this is the product-direction change from the legacy gate, which
        # only fired external search when the DUM Club side had no good match.
        async def _external_task() -> list[dict]:
            if not local_intent:
                return []
            return await self._search_external(normalised, city, lat, lng, external_limit)

        scored, external_rows = await asyncio.gather(
            asyncio.to_thread(self._search_dum_club, words, city),
            _external_task(),
        )

        self.log(
            f"query={normalised!r} city={city!r} local_intent={local_intent} "
            f"dum_matches={len(scored)} external={len(external_rows)}"
        )

        on_dum_club = self._build_dum_packets(scored[:limit], words)
        nearby_off_platform = self._build_external_packets(external_rows, words)

        return AgentResult(
            status="ok",
            data={
                "query": normalised,
                "city": city,
                "words": words,
                "local_intent": local_intent,
                "on_dum_club": on_dum_club,
                "nearby_off_platform": nearby_off_platform,
                "fallback_threshold": self._fallback_threshold,
            },
            reason="ok",
            logs=self._drain_logs(),
        )

    # ── Internal helpers ────────────────────────────────────────────────

    def _search_dum_club(self, words: list[str], city: str) -> list[tuple[dict, float]]:
        """
        Run the existing projects-with-embedded-offers query and score each
        candidate. Returns a list of (project, score) sorted by score desc,
        filtered to score > 0.
        """
        res = (
            self._sb.table("projects")
            .select(
                "id, title, name, description, category, template_type, status, "
                "offers(title, price_usd, quantity_sold, is_active)"
            )
            .eq("status", "live")
            .eq("review_status", "approved")
            .eq("is_deleted", False)
            .limit(200)
            .execute()
        )
        candidates = res.data or []

        scored: list[tuple[dict, float]] = []
        for p in candidates:
            s = score_project(p, words, city)
            if s > 0:
                scored.append((p, s))

        scored.sort(key=lambda x: -x[1])
        return scored

    async def _search_external(
        self,
        query: str,
        city: str,
        latitude: Optional[float],
        longitude: Optional[float],
        limit: int,
    ) -> list[dict]:
        """
        Call the injected places provider and persist new rows to the
        `external_businesses` table via upsert so demand-tracking hooks
        continue to work. Returns a list of dicts (one per external place)
        enriched with the DB `id` when upsert succeeded.
        """
        try:
            places = await self._places(
                query=query,
                city=city,
                latitude=latitude,
                longitude=longitude,
                limit=limit,
            )
        except Exception as exc:  # pragma: no cover — provider is injected
            self.log(f"external provider error: {exc!r}")
            return []

        rows: list[dict] = []
        for p in places:
            row = p.to_dict() if hasattr(p, "to_dict") else dict(p)
            db_id = ""
            try:
                upsert_res = (
                    self._sb.table("external_businesses")
                    .upsert(row, on_conflict="external_source,external_place_id")
                    .execute()
                )
                if upsert_res.data:
                    db_id = upsert_res.data[0].get("id", "") or ""
            except Exception as exc:
                # Non-blocking — discovery still works if persistence fails.
                self.log(f"external upsert failed: {exc!r}")
            row["id"] = db_id
            rows.append(row)

        return rows

    def _build_dum_packets(
        self,
        scored: list[tuple[dict, float]],
        words: list[str],
    ) -> list[dict]:
        """Shape DUM Club matches into the unified packet format."""
        packets: list[dict] = []
        for proj, score in scored:
            active = [o for o in (proj.get("offers") or []) if o.get("is_active") is True]
            pick, label, reason, explanation = pick_best_offer(active)
            all_sorted = sorted(active, key=lambda o: o.get("price_usd") or 0)
            packets.append({
                "project": {
                    "id": proj["id"],
                    "title": proj.get("title") or proj.get("name") or "",
                    "description": proj.get("description") or "",
                    "category": proj.get("template_type") or proj.get("category") or "",
                },
                "offer": (
                    {
                        "title": pick["title"],
                        "price_usd": pick.get("price_usd") or 0,
                        "sold": pick.get("quantity_sold") or 0,
                        "label": label,
                        "reason": reason,
                    }
                    if pick else None
                ),
                "all_offers": [
                    {
                        "title": o["title"],
                        "price_usd": o.get("price_usd") or 0,
                        "sold": o.get("quantity_sold") or 0,
                    }
                    for o in all_sorted
                ],
                "explanation": explanation,
                "score": score,
                "source": "dum_club",
                "on_dum_club": True,
                "confidence": round(min(score, 1.0), 4),
                "reason_for_match": self._explain_dum_match(proj, words),
                "claimable": False,
            })
        return packets

    def _build_external_packets(self, rows: list[dict], words: list[str]) -> list[dict]:
        """Shape external places into the unified packet format."""
        packets: list[dict] = []
        for row in rows:
            packets.append({
                "external_business_id": row.get("id", "") or "",
                "external_source": row.get("external_source", ""),
                "external_place_id": row.get("external_place_id", ""),
                "name": row.get("name", ""),
                "address": row.get("address", ""),
                "city": row.get("city", ""),
                "category": row.get("category", ""),
                "rating": row.get("rating"),
                "review_count": row.get("review_count", 0) or 0,
                "phone": row.get("phone", ""),
                "website": row.get("website", ""),
                "source": row.get("external_source", "") or "external",
                "on_dum_club": False,
                "confidence": self._external_confidence(row),
                "reason_for_match": self._explain_external_match(row, words),
                "claimable": True,
            })
        return packets

    @staticmethod
    def _external_confidence(row: dict) -> float:
        """
        Heuristic confidence for an external place based on rating and
        review count. Deterministic, no ML.
        """
        rating = row.get("rating") or 0
        reviews = row.get("review_count") or 0
        rating_component = max(min(rating / 5.0, 1.0), 0.0) * 0.6
        review_component = 0.0
        if reviews >= 500:
            review_component = 0.4
        elif reviews >= 100:
            review_component = 0.3
        elif reviews >= 20:
            review_component = 0.2
        elif reviews > 0:
            review_component = 0.1
        return round(rating_component + review_component, 4)

    @staticmethod
    def _explain_dum_match(project: dict, words: list[str]) -> str:
        """Produce a short human-readable reason for a DUM Club match."""
        title = (project.get("title") or project.get("name") or "").lower()
        for w in words:
            if w in title:
                return f"title contains '{w}'"
        desc = (project.get("description") or "").lower()
        for w in words:
            if w in desc:
                return f"description mentions '{w}'"
        offers = project.get("offers") or []
        offer_titles = " ".join((o.get("title") or "").lower() for o in offers)
        for w in words:
            if w in offer_titles:
                return f"offer mentions '{w}'"
        return "category match"

    @staticmethod
    def _explain_external_match(row: dict, words: list[str]) -> str:
        """Produce a short human-readable reason for an external match."""
        name = (row.get("name") or "").lower()
        for w in words:
            if w in name:
                return f"name contains '{w}'"
        category = (row.get("category") or "").lower()
        if category:
            return f"category '{category}'"
        rating = row.get("rating") or 0
        reviews = row.get("review_count") or 0
        if reviews > 0 or rating > 0:
            return f"highly rated nearby ({rating}★, {reviews} reviews)"
        return "nearby result"
