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
client = ollama.Client(host=OLLAMA_HOST)


class GenerateAppRequest(BaseModel):
    prompt: str
    wallet_address: str | None = None
    owner_id: str | None = None
    project_id: str | None = None


def try_parse_json(candidate: str) -> dict | None:
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


def extract_json_block(text: str) -> dict | None:
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

    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )

    raw_text = response["message"]["content"].strip()
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
