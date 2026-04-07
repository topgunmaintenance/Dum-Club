"""
Homepage AI explanation layer.

Generates a 1-2 sentence explanation for why the deterministic recommendation
system picked a specific offer for the customer's search query.  The AI never
chooses a different offer — it only explains the one already selected.

Architecture:
- The frontend deterministic system picks the offer instantly.
- This endpoint is called async; its response replaces the template text.
- If this call fails or is slow, the frontend keeps the template explanation.
"""

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    import anthropic
except ImportError:
    anthropic = None  # type: ignore[assignment]

router = APIRouter()

_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

_client = None
if anthropic and _ANTHROPIC_API_KEY:
    _client = anthropic.Anthropic(api_key=_ANTHROPIC_API_KEY)


# ── Category tones (shared with ai_chat.py) ──

CATEGORY_TONES = {
    "fitness": "energetic and action-oriented",
    "health": "encouraging and knowledgeable",
    "food": "warm and appetizing",
    "restaurant": "warm and appetizing",
    "bakery": "warm and detail-oriented",
    "cleaning": "efficient and reliable",
    "maintenance": "efficient and reliable",
    "consulting": "measured and professional",
    "legal": "measured and professional",
    "finance": "measured and professional",
    "design": "direct and capability-focused",
    "tech": "direct and capability-focused",
    "education": "patient and encouraging",
    "tutoring": "patient and encouraging",
    "coaching": "motivating and direct",
}

DEFAULT_TONE = "confident and helpful"


def _get_tone(category: str) -> str:
    cat = (category or "").lower()
    for key, tone in CATEGORY_TONES.items():
        if key in cat:
            return tone
    return DEFAULT_TONE


# ── Request / Response schemas ──

class OfferData(BaseModel):
    title: str
    price: float
    sold: int = 0


class HighlightedOffer(BaseModel):
    title: str
    price: float
    label: str  # "Most popular", "Best value", "Starting from", "Available now"
    reason: str  # "best_seller", "mid_tier", "cheapest", "only"


class MatchedProject(BaseModel):
    id: str
    title: str
    description: str = ""
    category: str = ""


class HomepageExplainRequest(BaseModel):
    query: str  # original search input
    city: str = ""
    matched_project: MatchedProject
    offers: list[OfferData]
    highlighted_offer: HighlightedOffer
    alternative_title: str = ""  # second result title if exists


# ── System prompt builder ──

def _build_system_prompt(req: HomepageExplainRequest) -> str:
    tone = _get_tone(req.matched_project.category)

    offers_block = "\n".join(
        f"  - {o.title}: ${o.price:.0f} ({o.sold} sold)"
        for o in req.offers
    ) if req.offers else "  (no offers listed)"

    reason_text = {
        "best_seller": f"{req.highlighted_offer.title} has the most purchases",
        "mid_tier": f"{req.highlighted_offer.title} is the best balance of price and scope",
        "cheapest": f"{req.highlighted_offer.title} is the most affordable option",
        "only": f"{req.highlighted_offer.title} is the available option",
    }.get(req.highlighted_offer.reason, f"{req.highlighted_offer.title} is a good match")

    return f"""You write a 1-2 sentence explanation for a search result on a marketplace homepage.

The customer searched for: "{req.query}"{f' in {req.city}' if req.city else ''}
We matched: {req.matched_project.title}
{f'About: {req.matched_project.description}' if req.matched_project.description else ''}

Available offers:
{offers_block}

We are recommending: {req.highlighted_offer.title} at ${req.highlighted_offer.price:.0f} (labeled "{req.highlighted_offer.label}")
Why: {reason_text}.
{f'There is also another matching business: {req.alternative_title}.' if req.alternative_title else ''}

YOUR JOB: Write 1-2 natural sentences explaining why this recommendation fits the customer's search. Mention the offer name and price exactly once.

TONE: Be {tone}.

STRICT RULES:
- Do NOT suggest a different offer. You are explaining the one already chosen.
- Do NOT invent features, delivery times, guarantees, or availability not stated above.
- Do NOT use markdown, bullet points, or lists. Natural sentences only.
- Do NOT say "as an AI" or "I recommend." Write as if you are the marketplace.
- Do NOT mention DUM Club, tokens, blockchain, or any internal platform details.
- If the business has no description, focus on the offer's price and label only.
- Maximum 2 sentences. Be direct."""


# ── Endpoint ──

@router.post("/homepage-explain")
async def homepage_explain(req: HomepageExplainRequest):
    """Generate an AI explanation for the homepage recommendation."""
    if not _client:
        raise HTTPException(status_code=503, detail="AI service not available")

    system = _build_system_prompt(req)

    try:
        resp = _client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=128,
            system=system,
            messages=[{"role": "user", "content": "Explain this recommendation."}],
        )
        explanation = next((b.text for b in resp.content if b.type == "text"), "")
    except Exception as e:
        print(f"[ai-homepage] error: {e}")
        raise HTTPException(status_code=500, detail="AI explanation failed")

    return {"explanation": explanation}
