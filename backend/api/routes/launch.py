"""
Instant-launch orchestration endpoint.

POST /api/launch/
  1. Calls Ollama to generate project metadata from the user's idea
  2. Derives a unique token symbol
  3. Inserts the project record
  4. Internally approves it (not a public endpoint — approval is scoped to this flow only)
  5. Seeds project_market_state so the project page shows price/volume immediately
  5b. Seeds default service profile (dormant)
  6. Creates a simulated token (SIM_ prefix) and sets token_status = "trading_live"
     and status = "live" so the project page renders fully live immediately
  7. Auto-generates 1-3 draft offers from the idea (best-effort)
  8. Returns project_id for the frontend to redirect to /project/{id}
"""

from __future__ import annotations

import json
import os
import re
import secrets
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import ollama
from db.supabase import get_client
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
_ollama = ollama.Client(host=OLLAMA_HOST, timeout=5)

_OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
_OPENAI_MODEL     = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_MODEL  = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

DEFAULT_TOKEN_SUPPLY = 21_000_000
DEFAULT_STARTING_PRICE = 0.001
LAUNCH_DAILY_LIMIT = 5

_SYSTEM_PROMPT = """
You are an AI product strategist for DUM Club, a platform that turns ideas into live business storefronts with real payments.

IMPORTANT: DUM Club does NOT build apps or playable games. It creates BUSINESS STOREFRONTS that sell products, services, and access passes. Every idea must be interpreted as a monetizable business.

A user will give you a project idea. Return ONLY valid JSON with this exact structure:

{
  "title": "Short project title",
  "description": "Clear one-paragraph description of the project",
  "template_type": "ai_app",
  "token_utility": "Why supporters benefit from this project"
}

Category Rules — detect the type of idea and adjust your output:

GAMING / ENTERTAINMENT (keywords: game, play, arcade, puzzle, rpg, shooter, racing, tetris, snake, chess, simulator, tycoon, strategy, platformer, battle, horror, idle, clicker, multiplayer):
- CRITICAL: Reinterpret as a BUSINESS selling around the game concept. Do NOT describe building the game itself.
- Title: premium entertainment brand name (e.g. "BlockDrop Arena", "ZombieStrike Studios", "PuzzleVault")
- Description: describe the business that sells access, memberships, early access passes, founder packs, tournament entry, and premium content around this game concept. Frame it as an entertainment brand, not a software product.
- Example: "zombie shooter" → "A premium zombie survival entertainment brand offering early access passes, founder packs, competitive tournament entry, and exclusive content drops for the gaming community."
- token_utility: "Supporters unlock founder-tier access, exclusive content, tournament entry, and early access to new releases"

APP/TOOL (keywords: app, tool, platform, dashboard, tracker, calculator, scheduler):
- Title: clean SaaS-style name (e.g. "TaskFlow Pro", "CalcMaster")
- Description: focus on what problem it solves and who it helps
- token_utility: "Supporters get premium features, priority support, and early access to updates"

CREATOR (keywords: art, music, beat, photo, video, course, ebook, podcast, design):
- Title: creator brand name (e.g. "BeatVault Studio", "DesignForge")
- Description: focus on the creative value and what customers get
- token_utility: "Supporters get exclusive content, behind-the-scenes access, and early drops"

DEFAULT (service, product, business):
- Title: 3-5 words, brandable business name
- Description: what the business does and who it helps
- token_utility: "Supporters get perks, discounts, and priority access"

General Rules:
- Return only JSON, no markdown, no code fences, no extra text
- Title: 3-5 words, brandable
- Description: one clear paragraph that SELLS the idea, not describes code
- NEVER describe technical implementation — describe the customer experience
- NEVER promise that DUM Club builds a playable game or app — it builds the BUSINESS around the concept
"""


# ── Pydantic models ────────────────────────────────────────────────────────────

class LaunchRequest(BaseModel):
    idea: str
    owner_id: Optional[str] = None
    wallet_address: Optional[str] = None


class LaunchResponse(BaseModel):
    status: str
    project_id: str
    title: str
    token_symbol: str
    token_mint_address: Optional[str] = None
    token_status: Optional[str] = None


# ── JSON helpers (mirrors generate_app.py approach) ───────────────────────────

def _try_parse(text: str) -> Optional[dict]:
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _extract_json(text: str) -> Optional[dict]:
    text = text.strip()
    parsed = _try_parse(text)
    if parsed:
        return parsed

    # Strip markdown fences
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    first = text.find("{")
    if first != -1:
        text = text[first:]
    opens, closes = text.count("{"), text.count("}")
    if opens > closes:
        text += "}" * (opens - closes)

    return _try_parse(text.strip())


# ── Token symbol helpers ───────────────────────────────────────────────────────

def _derive_symbol(title: str) -> str:
    """Derive a short uppercase token symbol from a project title."""
    words = re.sub(r"[^a-zA-Z0-9 ]", "", title).upper().split()
    letters = "".join(w[:2] for w in words if w)[:6]
    return letters if len(letters) >= 2 else ("DUM" + letters)[:6]


def _unique_symbol(supabase, base: str) -> str:
    """Return the first available token symbol derived from base."""
    base = base[:6].upper()
    candidates = [base] + [f"{base[:5]}{i}" for i in range(1, 10)]
    for candidate in candidates:
        res = (
            supabase.table("projects")
            .select("id")
            .eq("token_symbol", candidate)
            .execute()
        )
        if not res.data:
            return candidate
    # Last resort: fully random
    return ("DUM" + secrets.token_hex(2).upper())[:6]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _resolve_owner_uuid(supabase, owner_id: Optional[str]) -> Optional[str]:
    """Resolve any owner identity to a profiles.id UUID (FK target for projects.owner_id).

    - None / empty  → None (no owner stored)
    - Valid UUID    → returned as-is (assumed to already be a profiles.id)
    - Privy DID     → users.wallet_address → profiles.id (auto-create profile if needed)

    Raises HTTPException(422) if the Privy account has no wallet linked yet.
    """
    if not owner_id:
        return None
    if _UUID_RE.match(owner_id):
        return owner_id

    # Step 1: resolve privy_id → wallet_address via users table
    try:
        user_res = (
            supabase.table("users")
            .select("wallet_address")
            .eq("privy_id", owner_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        print(f"[launch] _resolve_owner_uuid users lookup failed: {exc!r}")
        return None

    if not user_res.data or not user_res.data[0].get("wallet_address"):
        # No wallet yet — return None; callers that need a profile UUID will handle this
        return None

    wallet = user_res.data[0]["wallet_address"]

    # Step 2: get or create profile by wallet_address → return profiles.id
    try:
        upsert_res = (
            supabase.table("profiles")
            .upsert({"wallet_address": wallet}, on_conflict="wallet_address")
            .select("id")
            .execute()
        )
        return upsert_res.data[0]["id"] if upsert_res.data else None
    except Exception as exc:
        print(f"[launch] _resolve_owner_uuid profile upsert failed: {exc!r}")
        return None


# ── Hosted LLM fallback (used when Ollama is unavailable) ─────────────────────

def _try_hosted_llm(idea: str) -> Optional[dict]:
    """Try OpenAI then Anthropic when Ollama is unavailable or timed out.
    Returns a parsed metadata dict or None if no hosted LLM is configured."""
    import httpx  # already in requirements-prod.txt; imported here to keep at call site

    user_msg = f"Project idea: {idea}"

    if _OPENAI_API_KEY:
        try:
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {_OPENAI_API_KEY}"},
                json={
                    "model": _OPENAI_MODEL,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT.strip()},
                        {"role": "user", "content": user_msg},
                    ],
                    "response_format": {"type": "json_object"},
                },
                timeout=30,
            )
            r.raise_for_status()
            choices = r.json().get("choices", [])
            text = (
                (choices[0].get("message") or {}).get("content", "").strip()
                if choices else ""
            )
            result = _extract_json(text) if text else None
            if result:
                print(f"[launch] hosted LLM: openai ({_OPENAI_MODEL})")
                return result
        except Exception:
            pass

    if _ANTHROPIC_API_KEY:
        try:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": _ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": _ANTHROPIC_MODEL,
                    "max_tokens": 512,
                    "system": _SYSTEM_PROMPT.strip(),
                    "messages": [{"role": "user", "content": user_msg}],
                },
                timeout=30,
            )
            r.raise_for_status()
            # Messages API: content is a list of typed blocks; find the first text block
            content_blocks = r.json().get("content", [])
            text = next(
                (b["text"] for b in content_blocks if b.get("type") == "text"),
                None,
            )
            result = _extract_json(text) if text else None
            if result:
                print(f"[launch] hosted LLM: anthropic ({_ANTHROPIC_MODEL})")
                return result
        except Exception:
            pass

    return None


_OFFERS_SYSTEM_PROMPT = """
You are helping a new business create their first product/service offers.

Given a business idea, generate 2 to 3 realistic offers this business could sell.
Return ONLY valid JSON — an array of objects with this structure:

[
  {
    "title": "Short offer name (3-6 words)",
    "description": "One sentence describing what the customer gets",
    "price_usd": 29.00,
    "offer_type": "digital_service"
  }
]

Category-Aware Pricing — adjust offers based on the type of idea:

GAMING / ENTERTAINMENT ideas (game, arcade, play, puzzle, shooter, racing, rpg, simulator, tycoon, strategy, platformer, battle, horror, idle, clicker, multiplayer):
- Frame as an entertainment BUSINESS selling around the game concept
- Offer examples: Early Access Pass, Founder Pack, VIP Membership, Tournament Pass, Beta Access, Community Pass, Cosmetic Pack, Lifetime Access, Supporter Tier
- Price range: $4.99 - $49.99
- offer_type: "digital_service"
- Descriptions should sound premium: "Get founder-tier access with exclusive perks and priority content drops" NOT "Play the game"

APP/TOOL ideas (app, tool, platform, calculator, tracker):
- Offer examples: Starter Plan, Pro Plan, Enterprise Access, API Credits
- Price range: $9 - $99/mo
- offer_type: "digital_service"

CREATOR ideas (art, music, course, ebook, design, photo):
- Offer examples: Single Download, Complete Bundle, Monthly Membership, Commission Slot
- Price range: $5 - $149
- offer_type: "digital_service"

SERVICE ideas (coaching, training, consulting, repair, cleaning):
- Offer examples: Single Session, Full Package, Monthly Retainer
- Price range: $29 - $297
- offer_type: "digital_service"

FOOD ideas (restaurant, bakery, catering, meal prep):
- Offer examples: Single Order, Party Package, Weekly Meal Plan
- Price range: $15 - $149
- offer_type: "physical_product"

Rules:
- Return only a JSON array, no markdown, no code fences, no extra text
- offer_type must be "digital_service" or "physical_product"
- Generate 2-3 offers at different price points
- Titles should be short and action-oriented
- Descriptions should be one clear sentence about what the customer gets
"""


def _extract_json_array(text: str) -> Optional[list]:
    """Extract a JSON array from LLM output."""
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    first = text.find("[")
    if first != -1:
        text = text[first:]
    opens, closes = text.count("["), text.count("]")
    if opens > closes:
        text += "]" * (opens - closes)
    try:
        parsed = json.loads(text.strip())
        return parsed if isinstance(parsed, list) else None
    except Exception:
        return None


def _generate_offers_from_idea(idea: str, title: str) -> Optional[list]:
    """Generate 1-3 draft offers using LLM. Returns list of offer dicts or None."""
    user_msg = f"Business idea: {idea}\nBusiness name: {title}"

    # Try Ollama first
    try:
        response = _ollama.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": _OFFERS_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
        raw = response["message"]["content"].strip()
        offers = _extract_json_array(raw)
        if offers:
            print(f"[launch] offers generated via ollama: {len(offers)}")
            return offers
    except Exception:
        pass

    # Fallback to hosted LLMs
    import httpx

    if _OPENAI_API_KEY:
        try:
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {_OPENAI_API_KEY}"},
                json={
                    "model": _OPENAI_MODEL,
                    "messages": [
                        {"role": "system", "content": _OFFERS_SYSTEM_PROMPT.strip()},
                        {"role": "user", "content": user_msg},
                    ],
                    "response_format": {"type": "json_object"},
                },
                timeout=30,
            )
            r.raise_for_status()
            text = (r.json().get("choices", [{}])[0].get("message") or {}).get("content", "")
            offers = _extract_json_array(text)
            if offers:
                print(f"[launch] offers generated via openai: {len(offers)}")
                return offers
        except Exception:
            pass

    if _ANTHROPIC_API_KEY:
        try:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": _ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": _ANTHROPIC_MODEL,
                    "max_tokens": 512,
                    "system": _OFFERS_SYSTEM_PROMPT.strip(),
                    "messages": [{"role": "user", "content": user_msg}],
                },
                timeout=30,
            )
            r.raise_for_status()
            content_blocks = r.json().get("content", [])
            text = next((b["text"] for b in content_blocks if b.get("type") == "text"), None)
            offers = _extract_json_array(text) if text else None
            if offers:
                print(f"[launch] offers generated via anthropic: {len(offers)}")
                return offers
        except Exception:
            pass

    return None


# ── Template matching ──────────────────────────────────────────────────────

_TEMPLATE_KEYWORDS: dict[str, list[str]] = {
    "tetris": ["tetris", "block stack", "falling block", "brick game", "block game", "block puzzle"],
    "snake": ["snake game", "snake arcade", "slither"],
    "memory": ["memory game", "memory match", "card match", "matching game", "card game", "flip card"],
    "2048": ["2048", "number tile", "tile merge", "sliding number", "number merge"],
    "pong": ["pong", "ping pong", "table tennis", "pong game", "paddle game"],
    "calculator": ["calculator", "calc"],
    "timer": ["timer", "stopwatch", "countdown", "time tracker"],
    "quiz": ["quiz", "trivia", "question game", "knowledge test"],
    "target": ["target practice", "aim trainer", "sniper game", "shoot target", "target shoot"],
    "topdown": ["zombie game", "zombie shoot", "survival shooter", "top down shoot", "arena shoot", "shooting game", "shooter game", "shoot em"],
    "defense": ["tower defense", "defend", "base defense", "turret"],
}


def _match_template(idea: str) -> Optional[str]:
    """Match an idea to a known interactive template. Returns template_id or None."""
    idea_lower = idea.lower()
    for template_id, keywords in _TEMPLATE_KEYWORDS.items():
        if any(kw in idea_lower for kw in keywords):
            return template_id
    return None


# ── Game-business detection + reframing ───────────────────────────────────────

_GAME_KEYWORDS = [
    "game", "games", "gaming", "play", "arcade", "puzzle", "rpg", "shooter",
    "racing", "tetris", "snake", "chess", "pong", "platformer", "simulator",
    "tycoon", "strategy", "battle", "horror", "idle", "clicker", "multiplayer",
    "mmorpg", "fps", "moba", "roguelike", "sandbox", "survival", "fortnite",
    "minecraft", "call of duty", "gta", "open world", "battle royale",
    "tower defense", "card game", "board game", "quiz",
]

_GAME_PHRASES = [
    "make a game", "build a game", "create a game", "launch a game",
    "game business", "game app", "mobile game", "video game", "online game",
    "game idea", "game concept", "sell a game", "game studio",
]


def _is_game_idea(idea: str) -> bool:
    """Check if the idea is game/entertainment related."""
    lower = idea.lower()
    if any(phrase in lower for phrase in _GAME_PHRASES):
        return True
    words = set(re.split(r"\W+", lower))
    return bool(words & set(_GAME_KEYWORDS))


def _reframe_game_idea(idea: str) -> str:
    """Enrich a game idea with business context so the LLM generates a business storefront."""
    return (
        f"{idea.strip()} — Interpret this as an entertainment BUSINESS concept. "
        f"Create a premium brand/storefront that sells access passes, founder packs, "
        f"memberships, and exclusive content around this idea. "
        f"Do NOT describe building the game itself."
    )


# Fallback offers when LLM fails for game-business ideas
_GAME_BUSINESS_FALLBACK_OFFERS = [
    {
        "title": "Early Access Pass",
        "description": "Get in before everyone else with exclusive early access and founder perks",
        "price_usd": 9.99,
        "offer_type": "digital_service",
    },
    {
        "title": "Founder Pack",
        "description": "Premium supporter tier with lifetime access, exclusive content, and VIP status",
        "price_usd": 29.99,
        "offer_type": "digital_service",
    },
    {
        "title": "Community Membership",
        "description": "Monthly access to premium content drops, tournaments, and community events",
        "price_usd": 4.99,
        "offer_type": "digital_service",
    },
]


# ── Main endpoint ──────────────────────────────────────────────────────────────

@router.post("/", response_model=LaunchResponse)
async def instant_launch(req: LaunchRequest):
    if not req.idea or not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea is required")

    if not req.wallet_address or not req.wallet_address.strip():
        raise HTTPException(status_code=400, detail="wallet_address is required to launch a project")

    try:
        return await _do_launch(req)
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[launch] UNHANDLED ERROR: {exc!r}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Launch failed: {exc}")


async def _do_launch(req: LaunchRequest) -> LaunchResponse:
    supabase = get_client()
    now = _now()

    # Resolve any non-UUID owner_id (e.g. Privy DID) to the users-table UUID.
    resolved_owner = _resolve_owner_uuid(supabase, req.owner_id)

    # ── 0. Rate limit: max 5 launches per identity per 24 hours ─────────────────
    if resolved_owner or req.wallet_address:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        q = supabase.table("projects").select("id", count="exact")
        if resolved_owner:
            q = q.eq("owner_id", resolved_owner)
        else:
            q = q.eq("wallet_address", req.wallet_address)
        recent = q.gte("created_at", cutoff).execute()
        if (recent.count or 0) >= LAUNCH_DAILY_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Launch limit reached. Try again tomorrow.",
            )

    # ── 1. Generate project metadata via Ollama → hosted LLM fallback ──────────
    is_game = _is_game_idea(req.idea.strip())
    llm_idea = _reframe_game_idea(req.idea.strip()) if is_game else req.idea.strip()
    if is_game:
        print(f"[launch] game idea detected — reframing as business concept")

    raw_output = ""
    _llm_used = "raw-idea fallback"
    try:
        response = _ollama.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Project idea: {llm_idea}"},
            ],
        )
        raw_output = response["message"]["content"].strip()
        parsed = _extract_json(raw_output)
        if parsed:
            _llm_used = f"ollama ({OLLAMA_MODEL})"
    except Exception:
        parsed = None

    if parsed is None:
        print("[launch] Ollama unavailable or returned invalid JSON — trying hosted LLM")
        parsed = _try_hosted_llm(llm_idea)
        if parsed:
            _llm_used = "hosted LLM"  # specific provider already logged inside _try_hosted_llm

    print(f"[launch] metadata source: {_llm_used}")

    if parsed:
        title = (parsed.get("title") or req.idea.strip())[:80]
        description = parsed.get("description") or req.idea.strip()
        template_type = parsed.get("template_type") or "ai_app"
        token_utility = (
            parsed.get("token_utility")
            or "Token holders get early access and community signals."
        )
    else:
        # Graceful fallback if Ollama is unavailable or returns invalid JSON
        title = req.idea.strip()[:80]
        description = req.idea.strip()
        template_type = "ai_app"
        token_utility = "Token holders get early access and community signals."

    # ── 2. Derive unique token symbol ────────────────────────────────────────
    base_sym = _derive_symbol(title)
    token_symbol = _unique_symbol(supabase, base_sym)

    # ── 3. Insert project record ─────────────────────────────────────────────
    project_payload: dict = {
        "name": title,
        "title": title,
        "description": description,
        "template_type": template_type,
        "category": "ai",
        "token_name": title,
        "token_symbol": token_symbol,
        "token_supply": DEFAULT_TOKEN_SUPPLY,
        "token_decimals": 9,
        "token_utility": token_utility,
        "status": "draft",
        "review_status": "pending",
        "token_status": "draft",
        "ai_output": {
            "title": title,
            "description": description,
            "template_type": template_type,
            "token_utility": token_utility,
            "raw_output": raw_output,
            "template_id": _match_template(req.idea.strip()),
        },
        "wallet_address": req.wallet_address,
        "created_at": now,
    }
    if resolved_owner:
        project_payload["owner_id"] = resolved_owner
    if req.owner_id and not _UUID_RE.match(req.owner_id):
        project_payload["privy_id"] = req.owner_id

    create_res = supabase.table("projects").insert(project_payload).execute()
    if not create_res.data:
        raise HTTPException(status_code=500, detail="Failed to create project")

    project_id: str = create_res.data[0]["id"]

    # ── 4. Internal approve ──────────────────────────────────────────────────
    # Scoped to this launch flow only — not a public self-approve endpoint.
    # Sets review_status = "approved" so the token pipeline can proceed later.
    supabase.table("projects").update(
        {"review_status": "approved"}
    ).eq("id", project_id).execute()

    # ── 5. Seed market state ─────────────────────────────────────────────────
    # Gives the project page a live price immediately.
    existing_market = (
        supabase.table("project_market_state")
        .select("id")
        .eq("project_id", project_id)
        .execute()
    )
    if not existing_market.data:
        supabase.table("project_market_state").insert(
            {
                "project_id": project_id,
                "price": DEFAULT_STARTING_PRICE,
                "market_cap": DEFAULT_STARTING_PRICE * DEFAULT_TOKEN_SUPPLY,
                "volume_24h": 0,
                "last_trade_at": None,
                "updated_at": now,
            }
        ).execute()

    # ── 5b. Seed default service profile ────────────────────────────────────
    # Dormant by default (is_active=False). Owner enables via /manage.
    # Check-first mirrors the market seed pattern; guards against retry duplicates
    # (service_profiles has UNIQUE(project_id) so a blind INSERT would fail).
    existing_profile = (
        supabase.table("service_profiles")
        .select("id")
        .eq("project_id", project_id)
        .execute()
    )
    if not existing_profile.data:
        supabase.table("service_profiles").insert(
            {
                "project_id": project_id,
                "service_type": "remote",
                "duration_minutes": 60,
                "buffer_minutes": 15,
                "price_per_token": 1.0,
                "currency": "USD",
                "service_description": None,
                "is_active": False,
                "updated_at": now,
            }
        ).execute()

    # ── 6. Create simulated token + set project fully live ─────────────────
    # Real on-chain minting requires Node.js + a funded Solana keypair.
    # Until that runtime is provisioned, generate a simulated mint address
    # and advance the token through the full lifecycle so the project page
    # renders with trading enabled the moment the user lands on it.
    sim_mint = "SIM_" + uuid.uuid4().hex[:24].upper()
    supabase.table("projects").update(
        {
            "token_mint_address": sim_mint,
            "token_status": "trading_live",
            "token_created_at": now,
            "status": "live",
        }
    ).eq("id", project_id).execute()
    print(f"[launch] token auto-created: {sim_mint} → trading_live")

    # ── 7. Auto-generate draft offers ──────────────────────────────────────
    # Best-effort: if LLM fails, the project still launches without offers.
    try:
        offer_list = _generate_offers_from_idea(llm_idea, title)
        # Fallback to curated game-business offers if LLM fails for game ideas
        if not offer_list and is_game:
            offer_list = _GAME_BUSINESS_FALLBACK_OFFERS
            print("[launch] using curated game-business fallback offers")
        if offer_list:
            for offer in offer_list[:3]:  # cap at 3
                offer_title = (offer.get("title") or "")[:120]
                offer_desc = offer.get("description") or ""
                price = float(offer.get("price_usd") or 0)
                offer_type = offer.get("offer_type", "digital_service")
                if offer_type not in ("digital_service", "physical_product"):
                    offer_type = "digital_service"
                if not offer_title or price < 0.50:
                    continue
                supabase.table("offers").insert({
                    "project_id": project_id,
                    "title": offer_title,
                    "description": offer_desc,
                    "price_usd": round(price, 2),
                    "offer_type": offer_type,
                    "token_discount_percent": 10,
                    "unlimited_inventory": True,
                    "quantity_sold": 0,
                    "is_active": True,
                }).execute()
            print(f"[launch] inserted {min(len(offer_list), 3)} auto-generated offers")
    except Exception as exc:
        print(f"[launch] offer auto-generation failed (non-fatal): {exc!r}")

    # ── 8. Award DUM Points for launching ────────────────────────────────
    try:
        if req.owner_id or req.wallet_address:
            privy_id = req.owner_id if req.owner_id and not _UUID_RE.match(req.owner_id) else None
            if privy_id:
                user_res = supabase.table("users").select("dum_balance").eq("privy_id", privy_id).limit(1).execute()
                if user_res.data:
                    current_dum = user_res.data[0].get("dum_balance", 50)
                    new_dum = current_dum + 25
                    supabase.table("users").update({"dum_balance": new_dum}).eq("privy_id", privy_id).execute()
                    try:
                        supabase.table("dum_transactions").insert({
                            "privy_id": privy_id, "amount": 25,
                            "reason": "launch_bonus", "reference_id": project_id,
                            "balance_after": new_dum,
                        }).execute()
                    except Exception:
                        pass
                    print(f"[launch] awarded 25 DUM to {privy_id} → {new_dum}")
    except Exception as exc:
        print(f"[launch] DUM award failed (non-fatal): {exc!r}")

    return LaunchResponse(
        status="success",
        project_id=project_id,
        title=title,
        token_symbol=token_symbol,
        token_mint_address=sim_mint,
        token_status="trading_live",
    )
