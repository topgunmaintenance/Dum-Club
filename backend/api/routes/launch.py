"""
Instant-launch orchestration endpoint.

POST /api/launch/
  1. Calls Ollama to generate project metadata from the user's idea
  2. Derives a unique token symbol
  3. Inserts the project record
  4. Internally approves it (not a public endpoint — approval is scoped to this flow only)
  5. Seeds project_market_state so the project page shows price/volume immediately
  6. Sets token_status = "trading_live" and status = "live" directly in DB
     (on-chain mint/minting is handled separately by the admin token pipeline)
  7. Returns project_id for the frontend to redirect to /project/{id}
"""

from __future__ import annotations

import json
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Optional

import ollama
from db.supabase import get_client
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
_ollama = ollama.Client(host=OLLAMA_HOST, timeout=30)

_OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
_OPENAI_MODEL     = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_ANTHROPIC_MODEL  = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

DEFAULT_TOKEN_SUPPLY = 21_000_000
DEFAULT_STARTING_PRICE = 0.001

_SYSTEM_PROMPT = """
You are an AI product strategist for DUM Club, an AI-powered Solana launchpad for ideas.

A user will give you a project idea. Return ONLY valid JSON with this exact structure:

{
  "title": "Short project title",
  "description": "Clear one-paragraph description of the project",
  "template_type": "ai_app",
  "token_utility": "Why early supporters and token holders benefit from this project"
}

Rules:
- Return only JSON, no markdown, no code fences, no extra text
- Title: 3-5 words, brandable
- Description: one clear paragraph, what the project does and who it helps
- token_utility: community and holder value — do NOT promise guaranteed services or returns
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


# ── Main endpoint ──────────────────────────────────────────────────────────────

@router.post("/", response_model=LaunchResponse)
async def instant_launch(req: LaunchRequest):
    if not req.idea or not req.idea.strip():
        raise HTTPException(status_code=400, detail="idea is required")

    supabase = get_client()
    now = _now()

    # ── 1. Generate project metadata via Ollama → hosted LLM fallback ──────────
    raw_output = ""
    _llm_used = "raw-idea fallback"
    try:
        response = _ollama.chat(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": f"Project idea: {req.idea.strip()}"},
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
        parsed = _try_hosted_llm(req.idea.strip())
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
        "utility_type": "access",
        "utility_value": token_utility,
        "status": "draft",
        "review_status": "pending",
        "token_status": "draft",
        "ai_output": {
            "title": title,
            "description": description,
            "template_type": template_type,
            "token_utility": token_utility,
            "raw_output": raw_output,
        },
        "created_at": now,
    }
    if req.owner_id:
        project_payload["owner_id"] = req.owner_id
    if req.wallet_address:
        project_payload["wallet_address"] = req.wallet_address

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

    # ── 6. Set project live ──────────────────────────────────────────────────
    # On-chain mint/minting (create-token, mint-tokens) requires funded Solana
    # wallets + Node scripts and is handled by the admin token pipeline later.
    # For instant launch we advance status in DB directly so the project page
    # renders as fully live the moment the user lands on it.
    supabase.table("projects").update(
        {"token_status": "trading_live", "status": "live"}
    ).eq("id", project_id).execute()

    return LaunchResponse(
        status="success",
        project_id=project_id,
        title=title,
        token_symbol=token_symbol,
    )
