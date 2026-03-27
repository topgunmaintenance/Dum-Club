from typing import Any, Dict, Optional

from fastapi import APIRouter
from pydantic import BaseModel
from db.supabase import get_client
import ollama
import os
import json
import re

router = APIRouter()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
client = ollama.Client(host=OLLAMA_HOST, timeout=30)

_GEN_OPENAI_API_KEY   = os.getenv("OPENAI_API_KEY", "")
_GEN_OPENAI_MODEL     = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_GEN_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_GEN_ANTHROPIC_MODEL  = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")


class GenerateAppRequest(BaseModel):
    prompt: str
    wallet_address: Optional[str] = None
    owner_id: Optional[str] = None
    project_id: Optional[str] = None


def try_parse_json(candidate: str) -> Optional[Dict[str, Any]]:
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def repair_json_string(text: str) -> str:
    text = text.strip()

    # remove markdown fences if present
    text = re.sub(r"^```json\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    # extract from first opening brace
    first_brace = text.find("{")
    if first_brace != -1:
        text = text[first_brace:]

    # if braces are unbalanced, add missing closing braces
    open_count = text.count("{")
    close_count = text.count("}")
    if open_count > close_count:
        text = text + ("}" * (open_count - close_count))

    return text.strip()


def extract_json_block(text: str) -> Optional[Dict[str, Any]]:
    text = text.strip()

    # 1) direct parse
    parsed = try_parse_json(text)
    if parsed:
        return parsed

    # 2) fenced block parse
    fenced_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if fenced_match:
        parsed = try_parse_json(fenced_match.group(1))
        if parsed:
            return parsed

    # 3) parse from first brace to end
    first_brace = text.find("{")
    if first_brace != -1:
        candidate = text[first_brace:]
        parsed = try_parse_json(candidate)
        if parsed:
            return parsed

        repaired = repair_json_string(candidate)
        parsed = try_parse_json(repaired)
        if parsed:
            return parsed

    # 4) broad regex object capture
    brace_match = re.search(r"(\{.*)", text, re.DOTALL)
    if brace_match:
        candidate = brace_match.group(1)
        repaired = repair_json_string(candidate)
        parsed = try_parse_json(repaired)
        if parsed:
            return parsed

    return None


def _generate_with_fallback(messages: list) -> str:
    """Call Ollama; fall back to OpenAI then Anthropic. Returns raw LLM text or '' on all failures."""
    import httpx

    # Primary: Ollama
    try:
        resp = client.chat(model=OLLAMA_MODEL, messages=messages)
        print("[generate] LLM: ollama")
        return resp["message"]["content"].strip()
    except Exception:
        print("[generate] Ollama unavailable — trying hosted LLM fallback")

    system_content = next(
        (m["content"] for m in messages if m.get("role") == "system"), ""
    )
    non_system = [m for m in messages if m.get("role") != "system"]

    # Fallback 1: OpenAI — json_object mode ensures valid JSON response
    if _GEN_OPENAI_API_KEY:
        try:
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {_GEN_OPENAI_API_KEY}"},
                json={
                    "model": _GEN_OPENAI_MODEL,
                    "messages": messages,
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
            if text:
                print(f"[generate] hosted LLM: openai ({_GEN_OPENAI_MODEL})")
                return text
        except Exception:
            pass

    # Fallback 2: Anthropic — system prompt separated per Messages API requirement
    if _GEN_ANTHROPIC_API_KEY:
        try:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": _GEN_ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": _GEN_ANTHROPIC_MODEL,
                    "max_tokens": 512,
                    "system": system_content,
                    "messages": non_system,
                },
                timeout=30,
            )
            r.raise_for_status()
            content_blocks = r.json().get("content", [])
            text = next(
                (b["text"] for b in content_blocks if b.get("type") == "text"),
                None,
            )
            if text:
                print(f"[generate] hosted LLM: anthropic ({_GEN_ANTHROPIC_MODEL})")
                return text
        except Exception:
            pass

    print("[generate] all LLM providers failed — using raw-idea fallback")
    return ""


@router.post("/")
async def generate_app(req: GenerateAppRequest):
    supabase = get_client()

    system_prompt = """
You are an AI product strategist for DUM Club.

A user will give you an app idea. Return ONLY valid JSON with this exact structure:

{
  "title": "Short app title",
  "description": "Clear one-paragraph app description",
  "template_type": "ai_app",
  "token_utility": "How the token is useful inside the app"
}

Rules:
- Return only JSON
- No markdown
- No code fences
- No explanation outside the JSON
- Keep title short and brandable
- Keep description clear and useful
- token_utility should explain why a project token matters
"""

    user_prompt = f"App idea: {req.prompt}"

    raw_text = _generate_with_fallback([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ])
    parsed = extract_json_block(raw_text)

    if parsed:
        title = parsed.get("title") or "AI App"
        description = parsed.get("description") or req.prompt
        template_type = parsed.get("template_type") or "ai_app"
        token_utility = parsed.get("token_utility") or "Token unlocks premium features and community rewards."
        ai_output = {
            "title": title,
            "description": description,
            "template_type": template_type,
            "token_utility": token_utility,
            "raw_output": raw_text,
        }
    else:
        title = "AI App"
        description = req.prompt
        template_type = "ai_generated"
        token_utility = "Token unlocks premium features and community rewards."
        ai_output = {
            "title": title,
            "description": description,
            "template_type": template_type,
            "token_utility": token_utility,
            "raw_output": raw_text,
        }

    payload = {
        "name": title,
        "title": title,
        "description": description,
        "template_type": template_type,
        "prompt": req.prompt,
        "token_utility": token_utility,
        "ai_output": ai_output,
    }

    if req.wallet_address:
        payload["wallet_address"] = req.wallet_address

    if req.owner_id:
        payload["owner_id"] = req.owner_id

    # If build flow already created a project, enrich that existing row.
    if req.project_id:
        updated = (
            supabase.table("projects")
            .update(payload)
            .eq("id", req.project_id)
            .execute()
        )
        created_project = updated.data[0] if updated.data and len(updated.data) > 0 else None
    else:
        # Fallback: create a fresh project with valid lifecycle defaults.
        payload["status"] = "draft"
        payload["review_status"] = "pending"
        created = supabase.table("projects").insert(payload).execute()
        created_project = created.data[0] if created.data and len(created.data) > 0 else None

    return {
        "status": "success",
        "project": created_project,
        "parsed_ai_output": ai_output,
    }
