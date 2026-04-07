"""
Homepage search endpoint.

Centralises query normalisation, eligibility filtering, scoring, and
deterministic offer selection that previously lived in the frontend.

Scoring (v1 — deterministic, no ML):
  title word match   0.40  (per word, strongest signal)
  offer-title match  0.25  (any active offer title contains a query word)
  description match  0.15  (per word)
  city text match    0.10  (city name in description)
  has-sales boost    0.05  (any offer with quantity_sold > 0)

Eligibility:
  status = "live", review_status = "approved", is_deleted = false,
  at least one active offer.
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel
import re

from services.external_places import search_nearby, ExternalPlace

from db.supabase import get_client

router = APIRouter()


# ── Helpers ──

_FIND_STRIP_RE = re.compile(
    r"^(find|find me|search|search for|looking for|i need|i want|"
    r"get me|show me|where can i|where can i get|where can i find|"
    r"who does|who sells)\s*",
    re.IGNORECASE,
)
_LOCAL_STRIP_RE = re.compile(
    r"\s*(near me|nearby|around here|close to me|in my area)\s*",
    re.IGNORECASE,
)
_CITY_RE = re.compile(r"\bin\s+([a-z][a-z\s]{1,20})$", re.IGNORECASE)
_ARTICLE_RE = re.compile(r"^(a|an|the)\s+", re.IGNORECASE)
_LOCAL_PHRASES = ["near me", "nearby", "around here", "close to me", "in my area", "local"]


def _has_local_intent(raw: str) -> bool:
    """Detect whether the query implies local/nearby intent."""
    lower = raw.lower()
    if any(p in lower for p in _LOCAL_PHRASES):
        return True
    if _CITY_RE.search(raw):
        return True
    return False


def _normalise_query(raw: str) -> tuple[str, str]:
    """Return (cleaned_query, city)."""
    text = raw.strip()
    city_match = _CITY_RE.search(text)
    city = city_match.group(1).strip().title() if city_match else ""
    cleaned = _FIND_STRIP_RE.sub("", text)
    cleaned = _LOCAL_STRIP_RE.sub("", cleaned)
    cleaned = re.sub(r"\s*in\s+[a-z\s]+$", "", cleaned, flags=re.IGNORECASE)
    cleaned = _ARTICLE_RE.sub("", cleaned)
    return cleaned.strip().lower(), city


def _pick_best_offer(offers: list[dict]) -> tuple[dict | None, str, str, str]:
    """Deterministic offer selection. Returns (offer, label, reason, explanation)."""
    if not offers:
        return None, "", "", ""

    sorted_by_price = sorted(offers, key=lambda o: o.get("price_usd") or 0)
    best_seller = max(offers, key=lambda o: o.get("quantity_sold") or 0)

    if (best_seller.get("quantity_sold") or 0) > 0:
        pick = best_seller
        label = "Most popular"
        reason = "best_seller"
        price = round(pick.get("price_usd") or 0)
        others = len(sorted_by_price) - 1
        explanation = (
            f"Most customers go with {pick['title']} at ${price}."
            + (f" {others} other option{'s' if others > 1 else ''} available." if others > 0 else "")
        )
    elif len(sorted_by_price) >= 3:
        pick = sorted_by_price[len(sorted_by_price) // 2]
        label = "Best value"
        reason = "mid_tier"
        explanation = f"{pick['title']} at ${round(pick.get('price_usd') or 0)} is the best balance of price and scope."
    elif len(sorted_by_price) == 2:
        pick = sorted_by_price[0]
        label = "Starting from"
        reason = "cheapest"
        p0 = round(sorted_by_price[0].get("price_usd") or 0)
        p1 = round(sorted_by_price[1].get("price_usd") or 0)
        explanation = f"Starts at ${p0}. There's also a ${p1} option with more included."
    else:
        pick = sorted_by_price[0]
        label = "Available now"
        reason = "only"
        explanation = f"{pick['title']} is available for ${round(pick.get('price_usd') or 0)}. A solid choice to start with."

    return pick, label, reason, explanation


def _score_project(project: dict, words: list[str], city: str) -> float:
    """Score a project + its embedded offers against query words."""
    title = (project.get("title") or project.get("name") or "").lower()
    desc = (project.get("description") or "").lower()
    offers = project.get("offers") or []
    active_offers = [o for o in offers if o.get("is_active") is True]

    if not active_offers:
        return 0.0  # Must have at least one active offer

    score = 0.0
    for w in words:
        if w in title:
            score += 0.40
        if w in desc:
            score += 0.15

    # Offer-title matching (single pass, no N+1)
    offer_titles = " ".join((o.get("title") or "").lower() for o in active_offers)
    for w in words:
        if w in offer_titles:
            score += 0.25
            break  # one boost per query, not per word

    # City boost
    if city and city.lower() in desc:
        score += 0.10

    # Sales boost
    if any((o.get("quantity_sold") or 0) > 0 for o in active_offers):
        score += 0.05

    return round(score, 4)


# ── Request / Response ──

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


# ── Endpoint ──

_FALLBACK_THRESHOLD = 0.3


@router.post("/homepage", response_model=SearchResponse)
async def homepage_search(req: SearchRequest):
    """Search for projects and offers matching a homepage query."""
    raw_query = req.query.strip()
    if not raw_query:
        return SearchResponse(fallback_needed=True, debug={"reason": "empty_query"})

    query, city = _normalise_query(raw_query)
    if req.city:
        city = req.city  # explicit city overrides extracted one
    words = [w for w in query.split() if len(w) > 2]

    if not words:
        return SearchResponse(fallback_needed=True, debug={"reason": "no_valid_words", "query": query})

    sb = get_client()

    # Single query: projects with embedded offers (avoids N+1)
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

    # Score all candidates
    scored = []
    for p in candidates:
        s = _score_project(p, words, city)
        if s > 0:
            scored.append((p, s))

    scored.sort(key=lambda x: -x[1])
    top = scored[: req.limit]

    # Fetch external nearby results for local-intent queries
    external_results: list[ExternalBusinessResult] = []
    local_intent = _has_local_intent(raw_query) or bool(city)
    if local_intent:
        places = await search_nearby(query=query, city=city, limit=5)
        for p in places:
            # Persist to DB for demand tracking (upsert by source+place_id)
            try:
                sb.table("external_businesses").upsert(
                    p.to_dict(),
                    on_conflict="external_source,external_place_id",
                ).execute()
            except Exception:
                pass  # non-blocking — search still works if persist fails
            external_results.append(ExternalBusinessResult(
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

    # Build results
    results: list[MatchResult] = []
    for proj, score in top:
        active = [o for o in (proj.get("offers") or []) if o.get("is_active") is True]
        pick, label, reason, explanation = _pick_best_offer(active)

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
