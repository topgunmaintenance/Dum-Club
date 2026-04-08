"""
Shared query normalisation + project scoring helpers.

Lifted from api/routes/search.py so both the route and the
LocalDiscoveryAgent can use the same logic without importing each other.
Behaviour is a line-for-line port of the original helpers — do not change
scoring constants here without a corresponding sanity check on homepage
search quality.
"""

from __future__ import annotations

import re


# ── Regexes (unchanged from original search.py) ──

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


def has_local_intent(raw: str) -> bool:
    """Detect whether a raw query implies local/nearby intent."""
    lower = raw.lower()
    if any(p in lower for p in _LOCAL_PHRASES):
        return True
    if _CITY_RE.search(raw):
        return True
    return False


def normalise_query(raw: str) -> tuple[str, str]:
    """
    Return (cleaned_query, city). Strips find/search verbs, local phrases,
    and "in <city>" suffixes. Lowercases the query.
    """
    text = raw.strip()
    city_match = _CITY_RE.search(text)
    city = city_match.group(1).strip().title() if city_match else ""
    cleaned = _FIND_STRIP_RE.sub("", text)
    cleaned = _LOCAL_STRIP_RE.sub("", cleaned)
    cleaned = re.sub(r"\s*in\s+[a-z\s]+$", "", cleaned, flags=re.IGNORECASE)
    cleaned = _ARTICLE_RE.sub("", cleaned)
    return cleaned.strip().lower(), city


def extract_query_words(query: str) -> list[str]:
    """Split a normalised query into scoring words (length > 2)."""
    return [w for w in query.split() if len(w) > 2]


# ── Project scoring (unchanged) ──


def score_project(project: dict, words: list[str], city: str) -> float:
    """
    Score a project + its embedded offers against query words.

    Scoring constants (v1 — deterministic, no ML):
        title word match   0.40  per word
        offer-title match  0.25  any active offer title contains a query word
        description match  0.15  per word
        city text match    0.10  city name in description
        has-sales boost    0.05  any offer with quantity_sold > 0

    Returns 0.0 if the project has no active offers.
    """
    title = (project.get("title") or project.get("name") or "").lower()
    desc = (project.get("description") or "").lower()
    offers = project.get("offers") or []
    active_offers = [o for o in offers if o.get("is_active") is True]

    if not active_offers:
        return 0.0

    score = 0.0
    for w in words:
        if w in title:
            score += 0.40
        if w in desc:
            score += 0.15

    offer_titles = " ".join((o.get("title") or "").lower() for o in active_offers)
    for w in words:
        if w in offer_titles:
            score += 0.25
            break  # one boost per query, not per word

    if city and city.lower() in desc:
        score += 0.10

    if any((o.get("quantity_sold") or 0) > 0 for o in active_offers):
        score += 0.05

    return round(score, 4)


def pick_best_offer(offers: list[dict]) -> tuple[dict | None, str, str, str]:
    """
    Deterministic best-offer picker. Returns (offer, label, reason, explanation).
    Lifted verbatim from search.py _pick_best_offer.
    """
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
