"""
Customer-facing AI Sales Assistant for project pages.

Knowledge architecture:
- The AI employee receives a structured KNOWLEDGE PACKET built from DB data only.
- Internal wiki (knowledge/) is NEVER loaded into customer-facing prompts.
- Wiki improves the prompt templates indirectly (better patterns, category rules).
- The packet has clear sections: business_summary, offer_catalog,
  recommendation_rules, assistant_identity, constraints.
"""
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
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


# ── Category-to-tone mapping (derived from wiki, not loaded from it) ──

CATEGORY_TONES = {
    "fitness": "energetic and action-oriented. Use short, confident sentences.",
    "health": "encouraging and knowledgeable. Be warm but factual.",
    "food": "warm and appetizing. Make the customer feel welcome.",
    "restaurant": "warm and appetizing. Make the customer feel welcome.",
    "bakery": "warm and detail-oriented. Mention quality and craft.",
    "cleaning": "efficient and reliable. Focus on results and timing.",
    "maintenance": "efficient and reliable. Focus on results and timing.",
    "consulting": "measured and professional. Use specifics, not superlatives.",
    "legal": "measured and professional. Be precise and clear.",
    "finance": "measured and professional. Be precise and clear.",
    "design": "direct and capability-focused. Emphasize outcomes.",
    "tech": "direct and capability-focused. Emphasize outcomes.",
    "education": "patient and encouraging. Ask good clarifying questions.",
    "tutoring": "patient and encouraging. Ask good clarifying questions.",
    "coaching": "motivating and direct. Focus on transformation.",
}

DEFAULT_TONE = "confident and helpful. Be direct, clear, and professional."


def _get_tone(category: str) -> str:
    """Derive assistant tone from business category."""
    cat = (category or "").lower()
    for key, tone in CATEGORY_TONES.items():
        if key in cat:
            return tone
    return DEFAULT_TONE


# ── Knowledge Packet Builder ──

def _build_knowledge_packet(project: dict, offers: list) -> dict:
    """
    Build a structured knowledge packet from DB data.
    This is the ONLY data the AI employee receives.
    Never include wiki content, internal notes, or engineering details.
    """
    name = project.get("title") or project.get("name") or "This Business"
    desc = project.get("description") or ""
    category = project.get("template_type") or project.get("category") or ""

    # Build offer catalog
    offer_catalog = []
    for o in offers:
        offer_catalog.append({
            "title": o.get("title", "Offer"),
            "price": o.get("price_usd", 0),
            "description": o.get("description") or "",
            "type": o.get("offer_type", ""),
        })

    # Recommendation rules
    recommendation = ""
    if offer_catalog:
        sorted_offers = sorted(offer_catalog, key=lambda o: o["price"])
        mid_idx = len(sorted_offers) // 2
        recommendation = sorted_offers[mid_idx]["title"] if len(sorted_offers) >= 2 else sorted_offers[0]["title"]

    return {
        "business_summary": {
            "name": name,
            "category": category,
            "description": desc,
        },
        "offer_catalog": offer_catalog,
        "recommendation_rules": {
            "default_recommendation": recommendation,
            "strategy": "recommend mid-tier when unsure, cheapest for budget-conscious, premium for best value",
        },
        "assistant_identity": {
            "tone": _get_tone(category),
            "role": f"sales representative for {name}",
        },
        "constraints": {
            "max_sentences": 3,
            "forbidden_topics": ["DUM Club", "tokens", "blockchain", "Solana", "crypto", "internal notes", "roadmap"],
            "forbidden_behaviors": ["invent offers", "invent prices", "invent policies", "use markdown", "say 'as an AI'"],
            "missing_info_response": "That's not listed here, but I can help you choose the best option from what's available.",
        },
    }


def _packet_to_system_prompt(packet: dict) -> str:
    """Convert a knowledge packet into a system prompt string."""
    biz = packet["business_summary"]
    offers = packet["offer_catalog"]
    rec = packet["recommendation_rules"]
    identity = packet["assistant_identity"]
    constraints = packet["constraints"]

    # Format offers block
    offers_block = ""
    if offers:
        for i, o in enumerate(offers, 1):
            offers_block += f"\nOFFER {i}: {o['title']}\n  Price: ${o['price']:.0f}\n"
            if o["description"]:
                offers_block += f"  Details: {o['description']}\n"
    else:
        offers_block = "\nNo offers listed yet.\n"

    return f"""You are the {identity['role']}. Your job is to help customers choose and purchase an offer.

BUSINESS: {biz['name']}
TYPE: {biz['category']}
ABOUT: {biz['description']}

AVAILABLE OFFERS:
{offers_block}
{f"RECOMMENDED DEFAULT: {rec['default_recommendation']} (suggest this when customers are unsure)" if rec['default_recommendation'] else ""}

YOUR TONE: Be {identity['tone']}

STRICT RULES — NEVER BREAK THESE:
1. You can ONLY discuss the offers listed above. Never invent offers, features, prices, discounts, availability, delivery times, or policies not explicitly stated above.
2. If a customer asks about something not covered above, say: "{constraints['missing_info_response']}"
3. Never say "as an AI" or "I'm an AI assistant." You are {biz['name']}'s representative.
4. Never mention {', '.join(constraints['forbidden_topics'])}. You represent this business only.
5. Never use markdown formatting, bullet points, or numbered lists. Write in natural sentences.

SALES BEHAVIOR:
When a customer asks what you offer, lead with the recommended option, then briefly mention alternatives.
When a customer is unsure, pick one for them. Say "I'd go with [name]" and give one reason.
When comparing offers, be direct about what each includes and the price difference.
When asked about price, state it clearly, then frame the value.
Always mention the offer name and exact price when recommending.
Keep responses to {constraints['max_sentences']} sentences. Be direct. No filler.

FIRST MESSAGE:
If the customer's first message is a greeting or general question, respond with a brief welcome and immediately recommend the best option.
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

    # Build knowledge packet → system prompt
    packet = _build_knowledge_packet(project, offers)
    system = _packet_to_system_prompt(packet)

    # Build messages
    messages = []
    for msg in req.history[-10:]:
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
        "offers": [{"title": o["title"], "price_usd": o["price"]} for o in packet["offer_catalog"]],
    }
