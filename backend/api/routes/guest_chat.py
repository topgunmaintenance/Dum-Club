"""
Guest chat — unauthenticated storefront visitors message a merchant, and
the merchant reads + replies from a dashboard inbox.

Tables `guest_conversations` / `guest_messages` are provisioned by a
SEPARATE migration (draft 076) applied out-of-band. This module references
them but does NOT create them; the endpoints will error until that
migration lands. All access is via the service-role client (RLS deny-all);
no direct PostgREST from the browser.

Ownership model: a merchant owns a storefront via
    projects.business_profile_id -> business_profiles.owner_privy_id
with a fallback to projects.privy_id. Verified fail-closed on every
merchant route.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request, Query
from pydantic import BaseModel

from db.supabase import get_client
from auth.privy import get_current_user
from services.live_limits import (
    client_ip_from_request,
    enforce_rate_limit_window,
)
from services.email import send_guest_reply_notification
from api.routes.projects import resolve_project_uuid

router = APIRouter()

# Display name shown to the merchant is hardcoded server-side regardless of
# whatever the visitor types — guests are never identified beyond this.
GUEST_DISPLAY_NAME = "Guest Customer"

_BODY_MIN = 1
_BODY_MAX = 2000
_MIN_TIME_ON_PAGE_MS = 3000          # bot gate: widget must be open >= 3s
_GUEST_RATE_MAX = 5                   # 5 messages
_GUEST_RATE_WINDOW_S = 600           # per 10 minutes, per IP AND per project
_URL_RE = re.compile(r"https?://", re.I)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Models ───────────────────────────────────────────────────────────

class GuestMessageIn(BaseModel):
    message: str
    name: Optional[str] = None
    email: Optional[str] = None
    hp: Optional[str] = None              # honeypot — must stay empty
    elapsed_ms: Optional[int] = None      # ms the widget was open before send
    conversation_id: Optional[str] = None


class MerchantReplyIn(BaseModel):
    message: str


# ── Helpers ──────────────────────────────────────────────────────────

def _looks_spammy(body: str, hp: Optional[str], elapsed_ms: Optional[int]) -> bool:
    """Cheap heuristics. A hit flags the conversation status='spam' (the
    message is still stored so the merchant can review, but it lands in a
    spam bucket instead of the open inbox)."""
    if hp:  # honeypot field was filled in -> almost certainly a bot
        return True
    if elapsed_ms is not None and elapsed_ms < _MIN_TIME_ON_PAGE_MS:
        return True
    if len(_URL_RE.findall(body)) >= 3:  # link-stuffed body
        return True
    return False


def _verify_project_owner(supabase, project_uuid: str, privy_id: str) -> dict:
    """Fail-closed ownership check. Returns the project row or raises.

    Strategy 1: projects.privy_id == caller.
    Strategy 2: business_profiles.owner_privy_id == caller, joined via
                projects.business_profile_id (the canonical merchant link).
    """
    prow = (
        supabase.table("projects")
        .select("id, privy_id, business_profile_id, name, title")
        .eq("id", project_uuid)
        .limit(1)
        .execute()
    )
    if not prow.data:
        raise HTTPException(status_code=404, detail="Storefront not found.")
    project = prow.data[0]

    if project.get("privy_id") and project["privy_id"] == privy_id:
        return project

    bp_id = project.get("business_profile_id")
    if bp_id:
        bres = (
            supabase.table("business_profiles")
            .select("owner_privy_id")
            .eq("id", bp_id)
            .limit(1)
            .execute()
        )
        if bres.data and bres.data[0].get("owner_privy_id") == privy_id:
            return project

    raise HTTPException(status_code=403, detail="Not the storefront owner.")


# ── Public: guest posts a message ────────────────────────────────────

@router.post("/conversations/{project_id}/message")
async def post_guest_message(project_id: str, body: GuestMessageIn, request: Request):
    """Unauthenticated. Create-or-link a guest conversation and append a
    guest message. Service-role write. Abuse controls: per-IP + per-project
    rate limit (5 / 10min), honeypot, min-time-on-page gate, length cap."""
    supabase = get_client()

    project_uuid = resolve_project_uuid(supabase, project_id)
    if not project_uuid:
        raise HTTPException(status_code=404, detail="Storefront not found.")

    # Rate limit BEFORE any write — per source IP and per target project.
    ip = client_ip_from_request(request)
    enforce_rate_limit_window(ip, "guest-msg-ip", _GUEST_RATE_MAX, _GUEST_RATE_WINDOW_S)
    enforce_rate_limit_window(
        f"proj:{project_uuid}", "guest-msg-project", _GUEST_RATE_MAX, _GUEST_RATE_WINDOW_S
    )

    text = (body.message or "").strip()
    if len(text) < _BODY_MIN:
        raise HTTPException(status_code=400, detail="Please enter a message.")
    if len(text) > _BODY_MAX:
        raise HTTPException(status_code=400, detail="Message is too long (2000 characters max).")

    status = "spam" if _looks_spammy(text, body.hp, body.elapsed_ms) else "open"

    # Create or link. A supplied conversation_id is honored ONLY if it
    # belongs to this project (never write into another project's thread).
    conv_id: Optional[str] = None
    if body.conversation_id:
        try:
            cres = (
                supabase.table("guest_conversations")
                .select("id, project_id")
                .eq("id", body.conversation_id)
                .limit(1)
                .execute()
            )
            if cres.data and cres.data[0].get("project_id") == project_uuid:
                conv_id = cres.data[0]["id"]
        except Exception:
            conv_id = None

    try:
        if conv_id is None:
            ins = (
                supabase.table("guest_conversations")
                .insert({
                    "project_id": project_uuid,
                    "guest_name": (body.name or None),
                    "guest_email": (body.email or None),
                    "status": status,
                    "last_message_at": _now_iso(),
                })
                .execute()
            )
            conv_id = ins.data[0]["id"]
        else:
            upd = {"last_message_at": _now_iso()}
            if status == "spam":
                upd["status"] = "spam"
            supabase.table("guest_conversations").update(upd).eq("id", conv_id).execute()

        supabase.table("guest_messages").insert({
            "conversation_id": conv_id,
            "sender": "guest",
            "body": text,
        }).execute()
    except Exception as exc:
        print(f"[guest-chat] post message failed project={project_uuid}: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="We couldn't send your message right now. Please try again in a moment.",
        )

    return {"ok": True, "conversation_id": conv_id, "status": status}


# ── Merchant: inbox list ─────────────────────────────────────────────

@router.get("/conversations/{project_id}")
async def list_conversations(
    project_id: str,
    current_user: dict = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Merchant inbox: conversations for one of their projects, newest
    activity first. Owner-checked, bounded. Display name hardcoded."""
    supabase = get_client()
    privy_id = current_user.get("sub")
    project_uuid = resolve_project_uuid(supabase, project_id) or project_id
    _verify_project_owner(supabase, project_uuid, privy_id)

    res = (
        supabase.table("guest_conversations")
        .select("id, project_id, status, guest_email, created_at, last_message_at")
        .eq("project_id", project_uuid)
        .order("last_message_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    convos = res.data or []
    for c in convos:
        c["display_name"] = GUEST_DISPLAY_NAME
    return convos


# ── Merchant: messages in a conversation ─────────────────────────────

@router.get("/conversations/{project_id}/{conversation_id}/messages")
async def list_messages(
    project_id: str,
    conversation_id: str,
    current_user: dict = Depends(get_current_user),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    supabase = get_client()
    privy_id = current_user.get("sub")
    project_uuid = resolve_project_uuid(supabase, project_id) or project_id
    _verify_project_owner(supabase, project_uuid, privy_id)

    # Conversation must belong to this project (fail-closed).
    cres = (
        supabase.table("guest_conversations")
        .select("id, project_id")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    if not cres.data or cres.data[0].get("project_id") != project_uuid:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    res = (
        supabase.table("guest_messages")
        .select("id, sender, body, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .range(offset, offset + limit - 1)
        .execute()
    )
    return res.data or []


# ── Merchant: reply ──────────────────────────────────────────────────

@router.post("/conversations/{project_id}/{conversation_id}/reply")
async def merchant_reply(
    project_id: str,
    conversation_id: str,
    body: MerchantReplyIn,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_client()
    privy_id = current_user.get("sub")
    project_uuid = resolve_project_uuid(supabase, project_id) or project_id
    project = _verify_project_owner(supabase, project_uuid, privy_id)

    text = (body.message or "").strip()
    if len(text) < _BODY_MIN:
        raise HTTPException(status_code=400, detail="Please enter a reply.")
    if len(text) > _BODY_MAX:
        raise HTTPException(status_code=400, detail="Reply is too long (2000 characters max).")

    cres = (
        supabase.table("guest_conversations")
        .select("id, project_id, guest_email")
        .eq("id", conversation_id)
        .limit(1)
        .execute()
    )
    if not cres.data or cres.data[0].get("project_id") != project_uuid:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    convo = cres.data[0]

    try:
        supabase.table("guest_messages").insert({
            "conversation_id": conversation_id,
            "sender": "merchant",
            "body": text,
        }).execute()
        supabase.table("guest_conversations").update(
            {"last_message_at": _now_iso()}
        ).eq("id", conversation_id).execute()
    except Exception as exc:
        print(f"[guest-chat] reply failed conversation={conversation_id}: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="We couldn't send your reply right now. Please try again in a moment.",
        )

    # Thread back to the guest over email when we have an address.
    guest_email = convo.get("guest_email")
    if guest_email:
        try:
            biz_name = project.get("name") or project.get("title") or ""
            send_guest_reply_notification(guest_email, biz_name, text, "")
        except Exception as exc:  # noqa: BLE001
            print(f"[guest-chat] reply email failed (non-fatal): {exc!r}")

    return {"ok": True}
