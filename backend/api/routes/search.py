"""
Homepage search endpoint.

This file now delegates to the Local Discovery Agent when the
`local_discovery_agent_enabled` feature flag is on. When the flag is off,
the previous byte-for-byte behaviour (DUM Club first, external fallback
only when no good DUM match) is preserved.

Wire contract of `POST /api/search/homepage` is NEVER broken. New fields
may be added; existing ones may not be removed or renamed.

New endpoint `POST /api/search/discover` returns the raw agent packet
shape (labeled on_dum_club / nearby_off_platform lists) for callers that
want the richer structure. It is additive and only active when the agent
flag is on.

Scoring (v1 — deterministic, no ML) and offer selection logic live in
services/agents/_search_helpers.py so both this route and the agent use
the exact same code path.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from services.live_limits import client_ip_from_request, enforce_rate_limit
from services.external_places import search_nearby
from services.agents.local_discovery import LocalDiscoveryAgent
from services.agents._search_helpers import (
    extract_query_words,
    has_local_intent,
    normalise_query,
    pick_best_offer,
    score_project,
)

from db.supabase import get_client
from api.routes.feature_flags import get_flag

router = APIRouter()


# ── Request / Response (stable wire contract) ──

class SearchRequest(BaseModel):
    query: str
    city: str = ""
    limit: int = 3


class OfferResult(BaseModel):
    title: str
    price_usd: float
    sold: int = 0
    label: str = ""
    reason: str = ""


class ProjectResult(BaseModel):
    id: str
    title: str
    description: str = ""
    category: str = ""


class MatchResult(BaseModel):
    project: ProjectResult
    offer: OfferResult | None = None
    all_offers: list[OfferResult] = []
    explanation: str = ""
    score: float = 0.0


class ExternalBusinessResult(BaseModel):
    id: str = ""  # DB id if persisted, empty for new discoveries
    external_source: str = ""
    external_place_id: str = ""
    name: str
    address: str = ""
    city: str = ""
    category: str = ""
    rating: float | None = None
    review_count: int = 0
    phone: str = ""
    website: str = ""


class SearchResponse(BaseModel):
    best_match: MatchResult | None = None
    other_options: list[MatchResult] = []
    nearby_external: list[ExternalBusinessResult] = []
    fallback_needed: bool = True
    debug: dict = {}


_FALLBACK_THRESHOLD = 0.3


# ── Helpers for the agent code path ──

def _packet_to_match_result(packet: dict) -> MatchResult:
    """Map a LocalDiscoveryAgent on_dum_club packet into the stable MatchResult shape."""
    offer_data = packet.get("offer")
    offer = None
    if offer_data:
        offer = OfferResult(
            title=offer_data.get("title", ""),
            price_usd=offer_data.get("price_usd") or 0,
            sold=offer_data.get("sold") or 0,
            label=offer_data.get("label", ""),
            reason=offer_data.get("reason", ""),
        )
    all_offers = [
        OfferResult(
            title=o.get("title", ""),
            price_usd=o.get("price_usd") or 0,
            sold=o.get("sold") or 0,
        )
        for o in (packet.get("all_offers") or [])
    ]
    proj = packet.get("project") or {}
    return MatchResult(
        project=ProjectResult(
            id=proj.get("id", ""),
            title=proj.get("title", ""),
            description=proj.get("description", ""),
            category=proj.get("category", ""),
        ),
        offer=offer,
        all_offers=all_offers,
        explanation=packet.get("explanation", ""),
        score=packet.get("score") or 0.0,
    )


def _packet_to_external_result(packet: dict) -> ExternalBusinessResult:
    """Map a LocalDiscoveryAgent nearby_off_platform packet into the stable ExternalBusinessResult shape."""
    return ExternalBusinessResult(
        id=packet.get("external_business_id") or "",
        external_source=packet.get("external_source", ""),
        external_place_id=packet.get("external_place_id", ""),
        name=packet.get("name", ""),
        address=packet.get("address", ""),
        city=packet.get("city", ""),
        category=packet.get("category", ""),
        rating=packet.get("rating"),
        review_count=packet.get("review_count", 0) or 0,
        phone=packet.get("phone", ""),
        website=packet.get("website", ""),
    )


async def _homepage_search_via_agent(req: SearchRequest) -> SearchResponse:
    """
    Agent-backed implementation. Produces the same SearchResponse shape the
    frontend already consumes, plus a debug flag indicating the agent path.
    """
    agent = LocalDiscoveryAgent(
        supabase=get_client(),
        places_provider=search_nearby,
        fallback_threshold=_FALLBACK_THRESHOLD,
    )
    result = await agent.run({
        "query": req.query,
        "city": req.city,
        "limit": req.limit,
        "external_limit": 10,
    })

    data = result.data or {}
    on_dum_club = data.get("on_dum_club") or []
    nearby = data.get("nearby_off_platform") or []

    match_results = [_packet_to_match_result(p) for p in on_dum_club]
    external_results = [_packet_to_external_result(p) for p in nearby]

    top_score = match_results[0].score if match_results else 0.0
    has_good_dum = bool(match_results) and top_score >= _FALLBACK_THRESHOLD

    debug = {
        "agent": "local_discovery",
        "query": data.get("query", ""),
        "city": data.get("city", ""),
        "words": data.get("words", []),
        "matches_found": len(match_results),
        "top_score": top_score,
        "external_count": len(external_results),
        "local_intent": data.get("local_intent", False),
        "status": result.status,
    }
    if result.reason and result.reason != "ok":
        debug["reason"] = result.reason

    if not has_good_dum:
        return SearchResponse(
            best_match=None,
            other_options=[],
            nearby_external=external_results,
            fallback_needed=len(external_results) == 0,
            debug=debug,
        )

    return SearchResponse(
        best_match=match_results[0],
        other_options=match_results[1:],
        nearby_external=external_results,
        fallback_needed=False,
        debug=debug,
    )


# ── Legacy (pre-agent) implementation ──

async def _homepage_search_legacy(req: SearchRequest) -> SearchResponse:
    """
    Byte-for-byte equivalent of the pre-agent code path. Used when the
    `local_discovery_agent_enabled` flag is off. Kept inline (rather than
    deleted) so the flag gives us a clean rollback.
    """
    raw_query = req.query.strip()
    if not raw_query:
        return SearchResponse(fallback_needed=True, debug={"reason": "empty_query"})

    query, city = normalise_query(raw_query)
    if req.city:
        city = req.city  # explicit city overrides extracted one
    words = extract_query_words(query)

    if not words:
        return SearchResponse(fallback_needed=True, debug={"reason": "no_valid_words", "query": query})

    sb = get_client()

    res = (
        sb.table("projects")
        .select("id, title, name, description, category, template_type, status, offers(title, price_usd, quantity_sold, is_active)")
        .eq("status", "live")
        .eq("review_status", "approved")
        .eq("is_deleted", False)
        .limit(200)
        .execute()
    )

    candidates = res.data or []

    scored = []
    for p in candidates:
        s = score_project(p, words, city)
        if s > 0:
            scored.append((p, s))

    scored.sort(key=lambda x: -x[1])
    top = scored[: req.limit]

    external_results: list[ExternalBusinessResult] = []
    local_intent = has_local_intent(raw_query) or bool(city)
    has_dum_match = top and top[0][1] >= _FALLBACK_THRESHOLD

    if local_intent and not has_dum_match:
        places = await search_nearby(query=query, city=city, limit=10)
        for p in places:
            db_id = ""
            try:
                upsert_res = sb.table("external_businesses").upsert(
                    p.to_dict(),
                    on_conflict="external_source,external_place_id",
                ).execute()
                if upsert_res.data:
                    db_id = upsert_res.data[0].get("id", "")
            except Exception:
                pass  # non-blocking — search still works if persist fails
            external_results.append(ExternalBusinessResult(
                id=db_id,
                external_source=p.external_source,
                external_place_id=p.external_place_id,
                name=p.name,
                address=p.address,
                city=p.city,
                category=p.category,
                rating=p.rating,
                review_count=p.review_count,
                phone=p.phone,
                website=p.website,
            ))

    if not top or top[0][1] < _FALLBACK_THRESHOLD:
        return SearchResponse(
            fallback_needed=len(external_results) == 0,
            nearby_external=external_results,
            debug={
                "agent": "legacy",
                "reason": "below_threshold" if top else "no_matches",
                "query": query,
                "city": city,
                "words": words,
                "candidates_checked": len(candidates),
                "matches_found": len(scored),
                "top_score": top[0][1] if top else 0,
                "external_count": len(external_results),
                "local_intent": local_intent,
            },
        )

    results: list[MatchResult] = []
    for proj, score in top:
        active = [o for o in (proj.get("offers") or []) if o.get("is_active") is True]
        pick, label, reason, explanation = pick_best_offer(active)

        all_sorted = sorted(active, key=lambda o: o.get("price_usd") or 0)
        all_offer_data = [
            OfferResult(title=o["title"], price_usd=o.get("price_usd") or 0, sold=o.get("quantity_sold") or 0)
            for o in all_sorted
        ]

        mr = MatchResult(
            project=ProjectResult(
                id=proj["id"],
                title=proj.get("title") or proj.get("name") or "",
                description=proj.get("description") or "",
                category=proj.get("template_type") or proj.get("category") or "",
            ),
            offer=OfferResult(
                title=pick["title"],
                price_usd=pick.get("price_usd") or 0,
                sold=pick.get("quantity_sold") or 0,
                label=label,
                reason=reason,
            ) if pick else None,
            all_offers=all_offer_data,
            explanation=explanation,
            score=score,
        )
        results.append(mr)

    return SearchResponse(
        best_match=results[0] if results else None,
        other_options=results[1:],
        nearby_external=external_results,
        fallback_needed=False,
        debug={
            "agent": "legacy",
            "query": query,
            "city": city,
            "words": words,
            "candidates_checked": len(candidates),
            "matches_found": len(scored),
            "top_score": results[0].score if results else 0,
            "external_count": len(external_results),
            "local_intent": local_intent,
        },
    )


# ── Endpoints ──

@router.post("/homepage", response_model=SearchResponse)
async def homepage_search(req: SearchRequest, request: Request):
    """
    Search for projects and offers matching a homepage query.

    Wire contract is stable. When the `local_discovery_agent_enabled`
    feature flag is on, execution is delegated to LocalDiscoveryAgent
    and the response includes `debug.agent = "local_discovery"`. When
    off, the original code path runs and `debug.agent = "legacy"`.
    """
    # Per-IP throttle on the public search path.
    enforce_rate_limit(client_ip_from_request(request), "search", 30)

    if get_flag("local_discovery_agent_enabled"):
        return await _homepage_search_via_agent(req)
    return await _homepage_search_legacy(req)


@router.post("/discover")
async def discover(req: SearchRequest, request: Request):
    """
    Raw Local Discovery Agent output — labeled on_dum_club and
    nearby_off_platform packets. Additive endpoint, intended for callers
    (admin tools, future UI surfaces, the other agents) that want the
    richer structured packet the agent emits internally.

    Returns 404-equivalent empty payload when the agent feature flag is
    off, so we do not accidentally ship raw agent data without the gate.
    """
    # Per-IP throttle on the public discover-search path.
    enforce_rate_limit(client_ip_from_request(request), "search", 30)

    if not get_flag("local_discovery_agent_enabled"):
        return {
            "enabled": False,
            "reason": "local_discovery_agent_enabled is off",
            "on_dum_club": [],
            "nearby_off_platform": [],
        }

    agent = LocalDiscoveryAgent(
        supabase=get_client(),
        places_provider=search_nearby,
        fallback_threshold=_FALLBACK_THRESHOLD,
    )
    result = await agent.run({
        "query": req.query,
        "city": req.city,
        "limit": req.limit,
        "external_limit": 10,
    })

    return {
        "enabled": True,
        "status": result.status,
        "reason": result.reason,
        "confidence": result.confidence,
        **(result.data or {}),
    }
