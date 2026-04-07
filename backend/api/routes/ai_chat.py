"""
Customer-facing AI Sales Assistant for project pages.

Knowledge architecture:
- The AI employee receives a structured KNOWLEDGE PACKET built from DB data only.
- Internal wiki (knowledge/) is NEVER loaded into customer-facing prompts.
- Wiki improves the prompt templates indirectly (better patterns, category rules).
- The packet has sections: business_summary, offer_catalog, recommendation_rules,
  assistant_identity, constraints, session_context.

Sales intelligence:
- Lightweight session memory (in-memory, auto-evicting)
- Deterministic intent classifier (keyword-based, not ML)
- Intent-aware prompt instructions (hesitant → frame value, comparing → be direct)
"""
import os
import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
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
    session_id: str = ""  # frontend-generated, one per chat open
    history: list = []


# ═══════════════════════════════════════════════════════════════════
# SESSION MEMORY — lightweight, in-memory, auto-evicting
# ═══════════════════════════════════════════════════════════════════

_SESSION_TTL = 1800  # 30 minutes
_sessions: dict[str, dict] = {}


def _session_key(project_id: str, session_id: str) -> str:
    return f"{project_id}:{session_id}" if session_id else ""


def _get_session(key: str) -> dict:
    if not key:
        return {}
    s = _sessions.get(key)
    if s and time.time() - s.get("_ts", 0) < _SESSION_TTL:
        return s
    _sessions.pop(key, None)
    return {}


def _set_session(key: str, data: dict):
    if not key:
        return
    data["_ts"] = time.time()
    _sessions[key] = data
    # Evict stale sessions (simple, no background thread)
    if len(_sessions) > 500:
        now = time.time()
        stale = [k for k, v in _sessions.items() if now - v.get("_ts", 0) > _SESSION_TTL]
        for k in stale:
            _sessions.pop(k, None)


# ═══════════════════════════════════════════════════════════════════
# INTENT CLASSIFIER — deterministic keyword matching
# ═══════════════════════════════════════════════════════════════════

def _classify_intent(message: str, session: dict) -> str:
    """
    Classify customer intent from current message + session flags.
    Returns: browsing | comparing | hesitant | ready_to_buy | unclear
    """
    msg = message.lower().strip()

    # ready_to_buy — strongest signal, check first
    buy_phrases = ["buy", "purchase", "checkout", "check out", "book", "sign up",
                   "start", "get started", "next step", "how do i pay", "i want",
                   "i'll take", "let's do", "go with", "i'll go with"]
    if any(p in msg for p in buy_phrases):
        return "ready_to_buy"

    # comparing
    compare_phrases = ["difference", "compare", "vs", "versus", "which one",
                       "between", "better", "or the", "both", "each one"]
    if any(p in msg for p in compare_phrases):
        return "comparing"

    # hesitant
    hesitant_phrases = ["expensive", "too much", "not sure", "maybe", "worth it",
                        "afford", "budget", "cheaper", "think about", "come back",
                        "idk", "hmm", "i don't know", "seems like a lot"]
    if any(p in msg for p in hesitant_phrases):
        return "hesitant"

    # browsing — broad questions
    browse_phrases = ["what do you", "what's available", "tell me about",
                      "what services", "what products", "show me", "options",
                      "menu", "offer", "list", "packages", "popular",
                      "what's most", "what is"]
    if any(p in msg for p in browse_phrases):
        return "browsing"

    # Check session history for context
    if session.get("hesitant"):
        return "hesitant"
    if session.get("comparing"):
        return "comparing"

    return "unclear"


# ═══════════════════════════════════════════════════════════════════
# CATEGORY TONES — derived from wiki, hardcoded here
# ═══════════════════════════════════════════════════════════════════

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
    cat = (category or "").lower()
    for key, tone in CATEGORY_TONES.items():
        if key in cat:
            return tone
    return DEFAULT_TONE


# ═══════════════════════════════════════════════════════════════════
# KNOWLEDGE PACKET BUILDER
# ═══════════════════════════════════════════════════════════════════

def _build_knowledge_packet(project: dict, offers: list, intent: str, session: dict) -> dict:
    """
    Build a structured knowledge packet from DB data + session context.
    This is the ONLY data the AI employee receives.
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

    # Recommendation rules — richer than before
    sorted_offers = sorted(offer_catalog, key=lambda o: o["price"]) if offer_catalog else []
    rec = {
        "default_recommendation": "",
        "cheapest": "",
        "premium": "",
        "entry": "",
        "comparison_notes": "",
        "objection_notes": "",
    }

    if sorted_offers:
        rec["cheapest"] = sorted_offers[0]["title"]
        rec["premium"] = sorted_offers[-1]["title"]
        rec["entry"] = sorted_offers[0]["title"]

        if len(sorted_offers) >= 2:
            mid = sorted_offers[len(sorted_offers) // 2]
            rec["default_recommendation"] = mid["title"]

            # Build comparison notes
            low = sorted_offers[0]
            high = sorted_offers[-1]
            diff = high["price"] - low["price"]
            if diff > 0:
                rec["comparison_notes"] = (
                    f"{low['title']} is ${low['price']:.0f}, "
                    f"{high['title']} is ${high['price']:.0f} "
                    f"(${diff:.0f} more, includes more)."
                )
        else:
            rec["default_recommendation"] = sorted_offers[0]["title"]

        # Objection notes — grounded only
        cheapest_price = sorted_offers[0]["price"]
        rec["objection_notes"] = (
            f"If price is a concern, {sorted_offers[0]['title']} "
            f"at ${cheapest_price:.0f} is the most affordable way to start."
        )

    return {
        "business_summary": {"name": name, "category": category, "description": desc},
        "offer_catalog": offer_catalog,
        "recommendation_rules": rec,
        "assistant_identity": {"tone": _get_tone(category), "role": f"sales representative for {name}"},
        "session_context": {"intent": intent, "hesitant": session.get("hesitant", False), "comparing": session.get("comparing", False)},
        "constraints": {
            "max_sentences": 3,
            "forbidden_topics": ["DUM Club", "tokens", "blockchain", "Solana", "crypto", "internal notes", "roadmap"],
            "forbidden_behaviors": ["invent offers", "invent prices", "invent policies", "use markdown", "say 'as an AI'"],
            "missing_info_response": "That's not listed here, but I can help you choose the best option from what's available.",
        },
    }


# ═══════════════════════════════════════════════════════════════════
# INTENT-AWARE PROMPT ASSEMBLY
# ═══════════════════════════════════════════════════════════════════

def _intent_instructions(intent: str, rec: dict) -> str:
    """Generate intent-specific sales instructions."""
    if intent == "ready_to_buy":
        return (
            "CUSTOMER INTENT: Ready to buy.\n"
            "Confirm their choice, mention the price, and tell them to click the offer to check out. "
            "Be brief and encouraging. One sentence is enough."
        )
    if intent == "comparing":
        return (
            "CUSTOMER INTENT: Comparing options.\n"
            f"Be direct about what each option includes and the price difference. "
            f"{rec.get('comparison_notes', '')} "
            "End by recommending one."
        )
    if intent == "hesitant":
        return (
            "CUSTOMER INTENT: Hesitant or price-concerned.\n"
            f"{rec.get('objection_notes', '')} "
            "Frame value, not price. Mention what they get, not what they spend. "
            "Do not pressure. Do not invent discounts."
        )
    if intent == "browsing":
        return (
            "CUSTOMER INTENT: Browsing.\n"
            f"Lead with your best recommendation ({rec.get('default_recommendation', 'the most popular option')}), "
            "then briefly mention alternatives. Be welcoming."
        )
    # unclear
    return (
        "CUSTOMER INTENT: Unclear.\n"
        f"Default to recommending {rec.get('default_recommendation', 'the best option')}. "
        "Keep it simple and conversational."
    )


def _packet_to_system_prompt(packet: dict) -> str:
    """Convert a knowledge packet into a system prompt string."""
    biz = packet["business_summary"]
    offers = packet["offer_catalog"]
    rec = packet["recommendation_rules"]
    identity = packet["assistant_identity"]
    constraints = packet["constraints"]
    ctx = packet["session_context"]

    # Format offers block
    offers_block = ""
    if offers:
        for i, o in enumerate(offers, 1):
            offers_block += f"\nOFFER {i}: {o['title']}\n  Price: ${o['price']:.0f}\n"
            if o["description"]:
                offers_block += f"  Details: {o['description']}\n"
    else:
        offers_block = "\nNo offers listed yet.\n"

    intent_block = _intent_instructions(ctx["intent"], rec)

    return f"""You are the {identity['role']}. Your job is to help customers choose and purchase an offer.

BUSINESS: {biz['name']}
TYPE: {biz['category']}
ABOUT: {biz['description']}

AVAILABLE OFFERS:
{offers_block}

{intent_block}

YOUR TONE: Be {identity['tone']}

STRICT RULES — NEVER BREAK THESE:
1. You can ONLY discuss the offers listed above. Never invent offers, features, prices, discounts, availability, delivery times, or policies not explicitly stated above.
2. If a customer asks about something not covered above, say: "{constraints['missing_info_response']}"
3. Never say "as an AI" or "I'm an AI assistant." You are {biz['name']}'s representative.
4. Never mention {', '.join(constraints['forbidden_topics'])}. You represent this business only.
5. Never use markdown formatting, bullet points, or numbered lists. Write in natural sentences.
6. Never invent discounts, guarantees, delivery times, or availability.

SALES RULES:
Always mention the offer name and exact price when recommending.
Keep responses to {constraints['max_sentences']} sentences. Be direct. No filler.
When the customer is ready, tell them to click the offer name to check out.

FIRST MESSAGE:
If the customer's first message is a greeting or general question, respond with a brief welcome and immediately recommend {rec.get('default_recommendation', 'the best option')}.
"""


# ═══════════════════════════════════════════════════════════════════
# ENDPOINT
# ═══════════════════════════════════════════════════════════════════

@router.post("/project-chat")
async def project_chat(req: ProjectChatRequest, debug: bool = Query(False)):
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

    # Session memory
    skey = _session_key(req.project_id, req.session_id)
    session = _get_session(skey)

    # Classify intent
    intent = _classify_intent(req.message, session)

    # Update session flags
    session["intent"] = intent
    if intent == "hesitant":
        session["hesitant"] = True
    if intent == "comparing":
        session["comparing"] = True
    _set_session(skey, session)

    # Build knowledge packet → system prompt
    packet = _build_knowledge_packet(project, offers, intent, session)
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

    result = {
        "answer": answer,
        "project_id": req.project_id,
        "offers": [{"title": o["title"], "price_usd": o["price"]} for o in packet["offer_catalog"]],
    }

    # Debug mode — development only, not exposed in UI
    if debug:
        result["_debug"] = {
            "intent": intent,
            "session": {k: v for k, v in session.items() if k != "_ts"},
            "recommendation": packet["recommendation_rules"],
            "tone": packet["assistant_identity"]["tone"],
        }

    return result
