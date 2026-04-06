"""
Customer-facing AI Sales Assistant for project pages.
Answers questions using real project + offer data.
No token gating — this is for customers, not owners.
"""
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from db.supabase import get_client

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


class ProjectChatRequest(BaseModel):
    project_id: str
    message: str
    history: list = []  # prior messages [{ role, content }]


def _build_sales_prompt(project: dict, offers: list) -> str:
    name = project.get("title") or project.get("name") or "This Business"
    desc = project.get("description") or ""
    category = project.get("template_type") or project.get("category") or ""

    # Build structured offer data — this is the ONLY source of truth
    offers_block = ""
    if offers:
        for i, o in enumerate(offers, 1):
            price = o.get("price_usd", 0)
            title = o.get("title", "Offer")
            odesc = o.get("description") or ""
            offers_block += f"\nOFFER {i}: {title}\n  Price: ${price:.0f}\n"
            if odesc:
                offers_block += f"  Details: {odesc}\n"
    else:
        offers_block = "\nNo offers listed yet.\n"

    # Identify best value and most popular for recommendation bias
    if offers:
        sorted_by_price = sorted(offers, key=lambda o: o.get("price_usd", 0))
        cheapest = sorted_by_price[0].get("title", "")
        mid = sorted_by_price[len(sorted_by_price) // 2].get("title", "")
        expensive = sorted_by_price[-1].get("title", "")
        recommendation = mid if len(offers) >= 2 else cheapest
    else:
        cheapest = mid = expensive = recommendation = ""

    return f"""You are the sales assistant for {name}. Your job is to help customers choose and purchase an offer.

BUSINESS: {name}
TYPE: {category}
ABOUT: {desc}

AVAILABLE OFFERS:
{offers_block}
{"RECOMMENDED DEFAULT: " + recommendation + " (suggest this when customers are unsure)" if recommendation else ""}

STRICT RULES — NEVER BREAK THESE:
1. You can ONLY discuss the offers listed above. Never invent offers, features, prices, discounts, availability, delivery times, or policies that are not explicitly stated above.
2. If a customer asks about something not covered above, say: "That's not listed here, but I can help you choose the best option from what's available."
3. Never say "as an AI" or "I'm an AI assistant." You are {name}'s sales representative.
4. Never mention DUM Club, tokens, blockchain, Solana, or crypto. You represent this business only.
5. Never use markdown formatting, bullet points, or numbered lists. Write in natural sentences.

SALES BEHAVIOR:
- When a customer asks what you offer: lead with the recommended option, then briefly mention alternatives.
- When a customer asks "which should I pick" or is unsure: pick one for them. Say "I'd go with [name]" and give one reason.
- When comparing offers: be direct about what each includes and the price difference.
- When asked about price: state it clearly, then frame the value ("that covers X and Y").
- Always mention the offer name and exact price when recommending.
- Keep responses to 2-3 sentences. Be direct. No filler.
- End recommendations with a natural nudge: "Want me to tell you more about it?" or "It's a great place to start."

FIRST MESSAGE BEHAVIOR:
If the customer's first message is a greeting or general question, respond with a brief welcome and immediately recommend the best option. Do not wait to be asked.
"""


@router.post("/project-chat")
async def project_chat(req: ProjectChatRequest):
    """Customer-facing AI chat for a project page."""
    if not _client:
        raise HTTPException(status_code=503, detail="AI service not available")

    sb = get_client()

    # Fetch project
    proj_res = (
        sb.table("projects")
        .select("id, title, name, description, template_type, category")
        .eq("id", req.project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not proj_res.data:
        raise HTTPException(status_code=404, detail="Business not found")
    project = proj_res.data[0]

    # Fetch active offers
    offers_res = (
        sb.table("offers")
        .select("title, description, price_usd, offer_type")
        .eq("project_id", req.project_id)
        .eq("is_active", True)
        .order("price_usd", desc=False)
        .execute()
    )
    offers = offers_res.data or []

    system = _build_sales_prompt(project, offers)

    # Build messages
    messages = []
    for msg in req.history[-10:]:  # last 10 messages max
        if msg.get("role") in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": req.message})

    try:
        resp = _client.messages.create(
            model=_ANTHROPIC_MODEL,
            max_tokens=512,
            system=system,
            messages=messages,
        )
        answer = next((b.text for b in resp.content if b.type == "text"), "")
    except Exception as e:
        print(f"[ai-chat] error: {e}")
        raise HTTPException(status_code=500, detail="AI response failed")

    return {
        "answer": answer,
        "project_id": req.project_id,
        "offers": [{"title": o.get("title", ""), "price_usd": o.get("price_usd", 0)} for o in offers],
    }
