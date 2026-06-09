from typing import Optional, Tuple

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from db.supabase import get_client
from services.token_mode import is_simulated_token, token_mode
from api.routes.projects import resolve_project_uuid
try:
    import anthropic
except ImportError:
    anthropic = None  # type: ignore[assignment]
import ollama
import os
import requests

router = APIRouter()

OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")

_ollama_client = ollama.Client(host=OLLAMA_HOST, timeout=30)

_CHAT_OPENAI_API_KEY  = os.getenv("OPENAI_API_KEY", "")
_CHAT_OPENAI_MODEL    = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
_CHAT_ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
_CHAT_ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

# Anthropic SDK client (primary provider)
_anthropic_client = None
if anthropic and _CHAT_ANTHROPIC_API_KEY:
    _anthropic_client = anthropic.Anthropic(api_key=_CHAT_ANTHROPIC_API_KEY)


class ChatRequest(BaseModel):
    message: str
    project_id: Optional[str] = None
    stream: bool = False


class ProjectGatedChatRequest(BaseModel):
    message: str
    project_id: str
    wallet_address: Optional[str] = None
    session_id: Optional[str] = None
    stream: bool = False


def load_project_memories(project_id: str) -> Tuple[str, int]:
    client = get_client()
    result = (
        client.table("memories")
        .select("content_text")
        .eq("project_id", project_id)
        .execute()
    )

    if result.data:
        memories_text = "\n".join(
            [m.get("content_text", "") for m in result.data if m.get("content_text")]
        )
        return memories_text, len(result.data)

    return "", 0


def build_system_prompt(project: dict, memories_text: str) -> str:
    title = (
        project.get("title")
        or project.get("name")
        or project.get("project_name")
        or "Untitled Project"
    )
    description = (
        project.get("description")
        or project.get("summary")
        or ""
    )
    template_type = project.get("template_type") or project.get("category") or ""
    refined_prompt = (
        project.get("refined_prompt")
        or project.get("prompt")
        or project.get("idea")
        or project.get("original_prompt")
        or ""
    )

    base = f"""You are the AI assistant for a specific DUM Club project.

PROJECT NAME:
{title}

PROJECT DESCRIPTION:
{description}

PROJECT TYPE:
{template_type}

PROJECT PROMPT:
{refined_prompt}

Rules:
Rules:
- Answer as the assistant for this specific project, not for DUM Club generally.
- If the user asks what the project does, explain this project in plain English.
- Do not describe DUM Club overall unless the user explicitly asks about DUM Club itself.
- Use the saved project memories if they are relevant.
- If information is missing, say so clearly instead of making things up.
- Keep answers clear, useful, and grounded in the project context.
- When the user asks what they asked before, answer directly using the recent chat history.
- Do not say this is the beginning of the conversation if prior chat history is present.
- If prior chat exists, refer to it plainly and briefly.


"""

    if memories_text:
        base += f"\nPROJECT MEMORIES:\n{memories_text}\n"

    return base


def wallet_holds_project_token(wallet_address: str, mint_address: str) -> bool:
    try:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTokenAccountsByOwner",
            "params": [
                wallet_address,
                {"mint": mint_address},
                {"encoding": "jsonParsed"}
            ]
        }

        response = requests.post(SOLANA_RPC_URL, json=payload, timeout=15)
        response.raise_for_status()
        data = response.json()

        accounts = data.get("result", {}).get("value", [])
        for account in accounts:
            parsed = (
                account.get("account", {})
                .get("data", {})
                .get("parsed", {})
                .get("info", {})
            )
            token_amount = parsed.get("tokenAmount", {})
            amount = token_amount.get("uiAmount", 0)

            if amount and amount > 0:
                return True

        return False
    except Exception:
        return False


def get_usage_record(project_id: str, wallet_address: Optional[str], session_id: Optional[str]):
    client = get_client()

    query = client.table("project_ai_usage").select("*").eq("project_id", project_id)

    if wallet_address:
        query = query.eq("wallet_address", wallet_address)
    elif session_id:
        query = query.eq("session_id", session_id)
    else:
        return None

    result = query.execute()
    return result.data[0] if result.data else None


def increment_usage(project_id: str, wallet_address: Optional[str], session_id: Optional[str]):
    client = get_client()

    existing = get_usage_record(project_id, wallet_address, session_id)

    if existing:
        updated_count = int(existing.get("question_count", 0)) + 1
        (
            client.table("project_ai_usage")
            .update({
                "question_count": updated_count,
                "updated_at": "now()"
            })
            .eq("id", existing["id"])
            .execute()
        )
        return updated_count

    insert_payload = {
        "project_id": project_id,
        "wallet_address": wallet_address,
        "session_id": session_id,
        "question_count": 1,
    }

    client.table("project_ai_usage").insert(insert_payload).execute()
    return 1


def load_chat_history(
    project_id: str,
    wallet_address: Optional[str],
    session_id: Optional[str],
    limit: int = 10,
):
    client = get_client()

    query = (
        client.table("project_chat_messages")
        .select("role, content, created_at")
        .eq("project_id", project_id)
        .order("created_at", desc=False)
        .limit(limit)
    )

    if wallet_address:
        query = query.eq("wallet_address", wallet_address)
    elif session_id:
        query = query.eq("session_id", session_id)
    else:
        return []

    result = query.execute()

    return [
        {"role": row["role"], "content": row["content"]}
        for row in (result.data or [])
        if row.get("role") in {"user", "assistant"} and row.get("content")
    ]


def save_chat_message(
    project_id: str,
    role: str,
    content: str,
    wallet_address: Optional[str],
    session_id: Optional[str],
):
    client = get_client()

    payload = {
        "project_id": project_id,
        "role": role,
        "content": content,
        "wallet_address": wallet_address,
        "session_id": session_id,
    }

    client.table("project_chat_messages").insert(payload).execute()


def _split_system(messages: list) -> Tuple[str, list]:
    """Extract the system prompt from message list (Anthropic requires it separate)."""
    system = next((m["content"] for m in messages if m.get("role") == "system"), "")
    non_system = [m for m in messages if m.get("role") != "system"]
    return system, non_system


def _chat_with_anthropic(messages: list) -> Optional[str]:
    """Non-streaming Claude call via the Anthropic SDK."""
    if not _anthropic_client:
        return None
    try:
        system, non_system = _split_system(messages)
        resp = _anthropic_client.messages.create(
            model=_CHAT_ANTHROPIC_MODEL,
            max_tokens=2048,
            system=system,
            messages=non_system,
        )
        text = next(
            (b.text for b in resp.content if b.type == "text"), None
        )
        if text:
            print(f"[chat] LLM: anthropic ({_CHAT_ANTHROPIC_MODEL})")
            return text
    except Exception as e:
        print(f"[chat] Anthropic error: {e}")
    return None


def _stream_with_anthropic(messages: list):
    """Streaming Claude call via the Anthropic SDK. Yields SSE-formatted tokens."""
    if not _anthropic_client:
        return None
    system, non_system = _split_system(messages)
    with _anthropic_client.messages.stream(
        model=_CHAT_ANTHROPIC_MODEL,
        max_tokens=2048,
        system=system,
        messages=non_system,
    ) as stream:
        for text in stream.text_stream:
            yield text


def _chat_with_fallback(messages: list) -> str:
    """Primary: Claude API. Fallback 1: OpenAI. Fallback 2: Ollama."""
    import httpx

    # Primary: Anthropic Claude
    result = _chat_with_anthropic(messages)
    if result:
        return result

    # Fallback 1: OpenAI
    if _CHAT_OPENAI_API_KEY:
        try:
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {_CHAT_OPENAI_API_KEY}"},
                json={"model": _CHAT_OPENAI_MODEL, "messages": messages},
                timeout=30,
            )
            r.raise_for_status()
            choices = r.json().get("choices", [])
            text = (
                (choices[0].get("message") or {}).get("content", "").strip()
                if choices else ""
            )
            if text:
                print(f"[chat] LLM: openai ({_CHAT_OPENAI_MODEL})")
                return text
        except Exception as e:
            print(f"[chat] OpenAI error: {e}")

    # Fallback 2: Ollama (local)
    try:
        resp = _ollama_client.chat(model=OLLAMA_MODEL, messages=messages)
        print("[chat] LLM: ollama")
        return resp["message"]["content"]
    except Exception as e:
        print(f"[chat] Ollama error: {e}")

    raise HTTPException(status_code=503, detail="AI service temporarily unavailable.")


@router.post("/")
async def chat(req: ChatRequest):
    client = get_client()
    memories_text = ""
    memories_used = 0
    project = {}

    if req.project_id:
        # Resolve slug-or-UUID to canonical UUID. Storefront URLs are
        # slug-addressed (/project/website-designer) and the owner-mode
        # AI assist forwards the slug verbatim into req.project_id. The
        # bare .eq("id", req.project_id) call raised Postgres 22P02 on
        # slugs — same uncaught-exception class PR #361 fixed for
        # live-reminders. Wrap the lookup in the same try/except shape
        # so any future DB hiccup returns a clean 500 instead of a
        # browser-invisible CORS-stripped failure.
        try:
            resolved_id = resolve_project_uuid(client, req.project_id)
            if not resolved_id:
                raise HTTPException(status_code=404, detail="Project not found")

            project_res = (
                client.table("projects")
                .select("*")
                .eq("id", resolved_id)
                .single()
                .execute()
            )
            project = project_res.data or {}
        except HTTPException:
            raise
        except Exception as exc:
            print(f"[chat] project lookup failed for project={req.project_id}: {exc!r}")
            raise HTTPException(
                status_code=500,
                detail="Couldn't get an AI response right now. Try again in a moment.",
            )

        memories_text, memories_used = load_project_memories(resolved_id)

    system = build_system_prompt(project, memories_text)

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": req.message},
    ]

    if req.stream:
        def event_stream():
            streamed = False
            # Primary: Claude streaming
            if _anthropic_client:
                try:
                    for token in _stream_with_anthropic(messages):
                        streamed = True
                        yield f"data: {token}\n\n"
                except Exception as e:
                    print(f"[chat/stream] Anthropic error: {e}")
            # Fallback: Ollama streaming
            if not streamed:
                try:
                    stream = _ollama_client.chat(model=OLLAMA_MODEL, messages=messages, stream=True)
                    for chunk in stream:
                        token = chunk["message"]["content"]
                        yield f"data: {token}\n\n"
                except Exception as e:
                    print(f"[chat/stream] Ollama error: {e}")
                    yield "data: Something went wrong.\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    answer = _chat_with_fallback(messages)

    return {
        "answer": answer,
        "project_id": req.project_id,
        "memories_used": memories_used,
    }


@router.post("/project-gated")
async def project_gated_chat(
    req: ProjectGatedChatRequest,
    x_session_id: Optional[str] = Header(default=None)
):
    client = get_client()

    # Resolve slug-or-UUID to canonical UUID. The frontend's Ask-AI panel
    # forwards the storefront URL slug verbatim (useParams()?.id), and the
    # prior bare .eq("id", req.project_id) raised Postgres 22P02 on slugs —
    # an uncaught exception that surfaced in the browser as
    # "TypeError: Failed to fetch" (CORS headers stripped on the error
    # response). Same fix template as PR #361 for live-reminders.
    try:
        resolved_id = resolve_project_uuid(client, req.project_id)
        if not resolved_id:
            raise HTTPException(status_code=404, detail="Project not found")

        project_res = (
            client.table("projects")
            .select("*")
            .eq("id", resolved_id)
            .single()
            .execute()
        )
        project = project_res.data
        if not project:
            # Resolver matched but row vanished (race with soft-delete).
            raise HTTPException(status_code=404, detail="Project not found")
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[chat/project-gated] project lookup failed for project={req.project_id}: {exc!r}")
        raise HTTPException(
            status_code=500,
            detail="Couldn't get an AI response right now. Try again in a moment.",
        )

    token_mint = project.get("token_mint_address")
    token_is_simulated = is_simulated_token(token_mint)
    # Doctrine §12: one free question, capped by code regardless of any
    # per-project override stored on the row. Migration 074 backfilled
    # every active row to ai_free_question_limit=1 and flipped the column
    # default to 1, so the column value is now informational only — the
    # runtime cap is enforced here.
    free_limit = 1
    holder_unlimited = bool(project.get("holder_ai_unlimited", True))

    session_id = req.session_id or x_session_id or f"anon:{req.project_id}"
    wallet_address = req.wallet_address

    # SIM_ mints have no on-chain presence — wallet_holds_project_token would
    # always return False for them. Skip the call entirely so we never
    # advertise a holder path that cannot exist.
    is_holder = False
    if wallet_address and token_mint and not token_is_simulated:
        is_holder = wallet_holds_project_token(wallet_address, token_mint)

    usage_record = get_usage_record(resolved_id, wallet_address, session_id)
    used_count = int(usage_record.get("question_count", 0)) if usage_record else 0

    if not (is_holder and holder_unlimited):
        if used_count >= free_limit:
            # Plain merchant-readable lock copy — no token/demo/on-chain/
            # holder jargon. The frontend surfaces a mailto CTA below this
            # string when contact_email is present on the project row.
            limit_message = "You've used your free question. Send the business a message for more answers."
            raise HTTPException(
                status_code=403,
                detail={
                    "message": limit_message,
                    "is_holder": False,
                    "free_limit": free_limit,
                    "used_count": used_count,
                    "free_questions_left": 0,
                    "token_required": not token_is_simulated,
                    "token_mint_address": token_mint,
                    "contact_email": project.get("contact_email"),
                    "business_name": project.get("title") or project.get("name"),
                }
            )

    memories_text, memories_used = load_project_memories(resolved_id)
    system = build_system_prompt(project, memories_text)
    history = load_chat_history(resolved_id, wallet_address, session_id, limit=10)

    messages = [{"role": "system", "content": system}]
    messages.extend(history)
    messages.append({"role": "user", "content": req.message})

    if req.stream:
        def event_stream():
            collected = ""
            streamed = False
            # Primary: Claude streaming
            if _anthropic_client:
                try:
                    for token in _stream_with_anthropic(messages):
                        streamed = True
                        collected += token
                        yield f"data: {token}\n\n"
                except Exception as e:
                    print(f"[chat/project-stream] Anthropic error: {e}")
            # Fallback: Ollama streaming
            if not streamed:
                try:
                    stream = _ollama_client.chat(model=OLLAMA_MODEL, messages=messages, stream=True)
                    for chunk in stream:
                        token = chunk["message"]["content"]
                        collected += token
                        yield f"data: {token}\n\n"
                except Exception as e:
                    print(f"[chat/project-stream] Ollama error: {e}")
                    yield "data: Something went wrong.\n\n"

            save_chat_message(resolved_id, "user", req.message, wallet_address, session_id)
            save_chat_message(resolved_id, "assistant", collected, wallet_address, session_id)

            increment_usage(resolved_id, wallet_address, session_id)
            yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    answer = _chat_with_fallback(messages)

    save_chat_message(resolved_id, "user", req.message, wallet_address, session_id)
    save_chat_message(resolved_id, "assistant", answer, wallet_address, session_id)

    new_count = used_count if (is_holder and holder_unlimited) else increment_usage(
        resolved_id, wallet_address, session_id
    )

    free_questions_left = max(0, free_limit - new_count)

    return {
        "answer": answer,
        "project_id": req.project_id,
        "memories_used": memories_used,
        "is_holder": is_holder,
        "free_limit": free_limit,
        "used_count": used_count if (is_holder and holder_unlimited) else new_count,
        "free_questions_left": 999999 if (is_holder and holder_unlimited) else free_questions_left,
        "holder_unlimited": holder_unlimited,
        # For SIM_ mints, the "token_required" holder path is not real. We
        # explicitly return False so clients cannot present a hold-to-unlock
        # upsell for a token that does not exist on-chain.
        "token_required": bool(token_mint) and not token_is_simulated,
        "token_mint_address": token_mint,
        "is_simulated": token_is_simulated,
        "token_mode": token_mode(token_mint),
    }
