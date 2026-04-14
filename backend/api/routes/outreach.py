"""
Merchant Outreach — manual cold-outreach layer.

╔════════════════════════════════════════════════════════════════════╗
║  DORMANT until Phase 1B. Do not trigger without deciding on        ║
║  target list and geography (Master Playbook Phase 0C / 1B).        ║
║                                                                    ║
║  Phase 0 demand acquisition is personal SMS to ~20 known contacts, ║
║  not cold email blasts to people you don't know. Triggering this   ║
║  module before you have a vetted target list risks burning Resend  ║
║  sender reputation, looking spammy, and undermining the trust the  ║
║  rest of the platform is trying to build.                          ║
║                                                                    ║
║  Re-enable condition: Phase 0 complete (≥3 real paid Stripe        ║
║  transactions from 3 different real customers) AND a target list   ║
║  of 20 Morris County mobile/home services merchants is in hand.    ║
║                                                                    ║
║  The endpoints below remain mounted and admin-gated by             ║
║  require_admin so they're testable, but should not be used in      ║
║  Phase 0 cleanup. See BACKLOG.md.                                  ║
╚════════════════════════════════════════════════════════════════════╝

Distinct from backend/api/routes/external_business.py's
merchant_outreach_queue flow, which is reactive (auto-queued after a
customer submits a verified purchase proof for an off-platform
business). This module is proactive: an admin manually enters leads,
sends email outreach from hand-picked templates, and tracks follow-ups.

Admin gating uses the existing require_admin dependency from
auth/privy.py — which checks users.is_admin. Do NOT introduce a parallel
ADMIN_PRIVY_IDS env-var based admin system.

Every outreach email MUST include a working unsubscribe link. The
render_outreach_template helper in services/email.py builds the HMAC-
signed unsubscribe URL automatically.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from auth.privy import require_admin, get_current_user
from db.supabase import get_client
from services.email import (
    OUTREACH_TEMPLATES,
    OUTREACH_FOLLOWUP_SEQUENCE,
    render_outreach_template,
    send_outreach_email,
    verify_unsubscribe_token,
)

router = APIRouter()


# ── Request models ──

class LeadCreate(BaseModel):
    contact: str
    business_name: Optional[str] = None
    source: Optional[str] = "manual"


class LeadSend(BaseModel):
    template_key: Optional[str] = "initial"


# ── Helpers ──

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fetch_lead_or_404(lead_id: str) -> dict:
    sb = get_client()
    res = (
        sb.table("outreach_leads")
        .select("*")
        .eq("id", lead_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    return res.data[0]


def _days_since(ts_iso: Optional[str]) -> Optional[float]:
    """Days elapsed since a TIMESTAMPTZ string, or None if missing/unparseable."""
    if not ts_iso:
        return None
    try:
        # Supabase returns ISO strings with +00:00 suffix
        dt = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
    except Exception:
        return None
    delta = datetime.now(timezone.utc) - dt
    return delta.total_seconds() / 86400.0


def _pick_followup_template(last_contacted_at: Optional[str]) -> Optional[str]:
    """Choose the next follow-up template based on elapsed time.

    Returns the template_key to send, or None if too soon or already past
    the last follow-up day.
    """
    elapsed = _days_since(last_contacted_at)
    if elapsed is None:
        # No prior contact — follow-up makes no sense yet.
        return None
    for min_days, key in OUTREACH_FOLLOWUP_SEQUENCE:
        if elapsed >= min_days:
            return key
    return None


def _record_message(
    lead_id: str,
    template_key: str,
    subject: str,
    plain_body: str,
    send_ok: bool,
    send_error: Optional[str],
) -> None:
    """Append an outreach_messages row. Non-fatal on failure — we log but
    don't re-raise because the caller has already attempted the send."""
    sb = get_client()
    try:
        sb.table("outreach_messages").insert({
            "lead_id": lead_id,
            "template_key": template_key,
            "subject": subject,
            "message": plain_body,
            "channel": "email",
            "send_ok": send_ok,
            "send_error": send_error,
        }).execute()
    except Exception as exc:
        print(f"[outreach] failed to record message for lead={lead_id}: {exc!r}")


# ══════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ══════════════════════════════════════════════════════════════════


@router.get("/am-i-admin")
async def am_i_admin(current_user: dict = Depends(get_current_user)):
    """Lightweight auth probe for the frontend — lets the admin outreach
    page decide whether to render the form or show a 'not authorized'
    message WITHOUT calling one of the real admin endpoints (which 403).

    Returns { is_admin: bool }.
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        return {"is_admin": False}
    sb = get_client()
    try:
        res = sb.table("users").select("is_admin").eq("privy_id", privy_id).limit(1).execute()
        if res.data and res.data[0].get("is_admin"):
            return {"is_admin": True}
    except Exception as exc:
        print(f"[outreach] am_i_admin lookup failed: {exc!r}")
    return {"is_admin": False}


@router.post("/leads")
async def create_lead(body: LeadCreate, _admin: dict = Depends(require_admin)):
    """Add a new lead. Idempotent on LOWER(contact) — if a lead with the
    same email already exists, returns the existing row with created=false.
    """
    contact = (body.contact or "").strip()
    if not contact:
        raise HTTPException(status_code=400, detail="contact is required")

    sb = get_client()

    # Idempotency check against the LOWER(contact) unique index.
    existing = (
        sb.table("outreach_leads")
        .select("*")
        .ilike("contact", contact)  # case-insensitive match
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"lead": existing.data[0], "created": False}

    row = {
        "contact": contact,
        "business_name": (body.business_name or "").strip() or None,
        "source": (body.source or "manual").strip() or "manual",
        "status": "new",
    }
    try:
        res = sb.table("outreach_leads").insert(row).execute()
    except Exception as exc:
        # If two admins hit this at exactly the same moment, the unique
        # index catches the collision. Treat as idempotent.
        print(f"[outreach] insert lead fell through to existing lookup: {exc!r}")
        retry = (
            sb.table("outreach_leads")
            .select("*")
            .ilike("contact", contact)
            .limit(1)
            .execute()
        )
        if retry.data:
            return {"lead": retry.data[0], "created": False}
        raise HTTPException(status_code=500, detail=f"Failed to create lead: {exc!r}")

    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create lead")
    return {"lead": res.data[0], "created": True}


@router.get("/leads")
async def list_leads(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=100, le=500),
    _admin: dict = Depends(require_admin),
):
    """List leads, newest first. Optional status filter."""
    sb = get_client()
    q = sb.table("outreach_leads").select("*").order("created_at", desc=True).limit(limit)
    if status:
        q = q.eq("status", status)
    res = q.execute()
    return {"leads": res.data or []}


@router.post("/leads/{lead_id}/send")
async def send_lead_initial(
    lead_id: str,
    body: LeadSend,
    _admin: dict = Depends(require_admin),
):
    """Send the initial (or named) outreach email to a lead.

    Safe-guards:
      - Unknown template_key → 400
      - Lead status 'unsubscribed' → 400 (respect opt-out)
      - Provider failure is still recorded in outreach_messages with
        send_ok=false + send_error so the admin can see what went wrong
        in the leads list, but the endpoint returns 200.
    """
    lead = _fetch_lead_or_404(lead_id)

    if lead.get("status") == "unsubscribed":
        raise HTTPException(status_code=400, detail="Lead has unsubscribed")

    template_key = (body.template_key or "initial").strip()
    if template_key not in OUTREACH_TEMPLATES:
        raise HTTPException(status_code=400, detail=f"Unknown template_key: {template_key}")

    try:
        subject, plain_body, html_body = render_outreach_template(
            template_key,
            lead.get("business_name"),
            lead["contact"],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Template render failed: {exc!r}")

    send_ok, err = send_outreach_email(lead["contact"], subject, html_body)

    # Record message regardless of provider success/failure.
    _record_message(lead_id, template_key, subject, plain_body, send_ok, err)

    # Only bump the lead's contact metadata on a successful send.
    if send_ok:
        sb = get_client()
        try:
            sb.table("outreach_leads").update({
                "status": "contacted",
                "last_contacted_at": _now_iso(),
            }).eq("id", lead_id).execute()
        except Exception as exc:
            print(f"[outreach] failed to bump lead {lead_id}: {exc!r}")

    return {
        "sent": send_ok,
        "template_key": template_key,
        "send_error": err,
    }


@router.post("/leads/{lead_id}/follow-up")
async def send_lead_followup(
    lead_id: str,
    _admin: dict = Depends(require_admin),
):
    """Send the next follow-up template based on days since last_contacted_at.

    Returns:
      - 200 with template_key + sent=true/false if a template was matched
      - 400 if the lead is unsubscribed
      - 409 if:
          * lead is already onboarded (no need to follow up)
          * no prior contact at all (use /send first)
          * less than 2 days since last contact (too soon)
          * already past the final day-10 follow-up (sequence exhausted)
    """
    lead = _fetch_lead_or_404(lead_id)

    if lead.get("status") == "unsubscribed":
        raise HTTPException(status_code=400, detail="Lead has unsubscribed")
    if lead.get("status") == "onboarded":
        raise HTTPException(status_code=409, detail="Lead is already onboarded")

    last_contacted_at = lead.get("last_contacted_at")
    if not last_contacted_at:
        raise HTTPException(status_code=409, detail="No prior contact — use /send first")

    template_key = _pick_followup_template(last_contacted_at)
    if not template_key:
        raise HTTPException(status_code=409, detail="Too soon for a follow-up (wait at least 2 days)")

    subject, plain_body, html_body = render_outreach_template(
        template_key,
        lead.get("business_name"),
        lead["contact"],
    )

    send_ok, err = send_outreach_email(lead["contact"], subject, html_body)
    _record_message(lead_id, template_key, subject, plain_body, send_ok, err)

    if send_ok:
        sb = get_client()
        try:
            sb.table("outreach_leads").update({
                "last_contacted_at": _now_iso(),
                # status stays 'contacted' — we don't have a finer-grained value
            }).eq("id", lead_id).execute()
        except Exception as exc:
            print(f"[outreach] failed to bump lead {lead_id}: {exc!r}")

    return {
        "sent": send_ok,
        "template_key": template_key,
        "send_error": err,
    }


# ══════════════════════════════════════════════════════════════════
# PUBLIC UNSUBSCRIBE
# ══════════════════════════════════════════════════════════════════


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(contact: str = Query(...), token: str = Query(...)):
    """One-click unsubscribe endpoint for outreach email recipients.

    Public, no auth — must work from an email link. HMAC-signed token
    prevents random URL fuzzing from unsubscribing people. Mandatory
    for CAN-SPAM compliance and to protect Resend sender reputation.

    Returns a small HTML confirmation page.
    """
    if not verify_unsubscribe_token(contact, token):
        raise HTTPException(status_code=400, detail="Invalid unsubscribe token")

    sb = get_client()
    try:
        # Find the lead by case-insensitive contact match. If none exists
        # we still return 200 — mission accomplished from the recipient's
        # perspective — but don't touch the DB.
        res = (
            sb.table("outreach_leads")
            .select("id, status")
            .ilike("contact", contact.strip())
            .limit(1)
            .execute()
        )
        if res.data:
            lead = res.data[0]
            sb.table("outreach_leads").update({
                "status": "unsubscribed",
                "unsubscribed_at": _now_iso(),
            }).eq("id", lead["id"]).execute()
    except Exception as exc:
        print(f"[outreach] unsubscribe DB update failed for {contact}: {exc!r}")
        # Don't fail the request — the recipient still gets confirmation.

    html = """
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Unsubscribed — DUM Club</title>
        <style>
          body { margin: 0; padding: 48px 20px; font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e4e4e7; }
          .card { max-width: 420px; margin: 0 auto; padding: 32px; background: #111; border: 1px solid #27272a; border-radius: 16px; text-align: center; }
          .check { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: rgba(74,222,128,0.15); color: #4ade80; font-size: 32px; line-height: 56px; }
          h1 { margin: 0 0 8px; color: #fff; font-size: 20px; }
          p { margin: 0; color: #a1a1aa; font-size: 14px; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="check">&#10003;</div>
          <h1>You're unsubscribed</h1>
          <p>You won't receive any more outreach emails from DUM Club. Thanks for letting us know.</p>
        </div>
      </body>
    </html>
    """
    return HTMLResponse(content=html, status_code=200)
