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

    offers_text = ""
    if offers:
        for o in offers:
            price = o.get("price_usd", 0)
            offers_text += f"\n- {o.get('title', 'Offer')}: ${price:.0f}"
            if o.get("description"):
                offers_text += f" — {o['description']}"

    return f"""You are the AI sales assistant for {name}.

BUSINESS: {name}
DESCRIPTION: {desc}
CATEGORY: {category}

OFFERS AVAILABLE:{offers_text if offers_text else " None listed yet."}

YOUR ROLE:
- You represent this business to potential customers.
- Answer questions using ONLY the information above. Do not invent features, policies, or details.
- When recommending an offer, mention its name and price naturally.
- If asked something you don't know, say "I'd need to check with the team on that" — never fabricate.
- Keep responses short (2-4 sentences max). Be helpful, not pushy.
- Use a confident, professional tone that matches the business type.
- When a customer seems interested, suggest the most relevant offer by name.
- Never mention DUM Club, tokens, blockchain, or crypto. You are this business's assistant, not a platform bot.
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
