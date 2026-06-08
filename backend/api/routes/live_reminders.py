"""
Customer-side "remind me when this merchant goes live" subscriptions.

Public POST endpoint (no auth required — the storefront sign-up form is
visible to anyone watching the merchant's page). Writes to the
live_reminders table created by migration 065. The cron worker at
backend/services/agents/live_reminders.py picks up unsent rows and
sends the email.

Idempotency: live_reminders has a UNIQUE (project_id, customer_email,
scheduled_for) constraint. The endpoint translates a 23505 unique
violation into a 200 OK with `already_subscribed: true` so a customer
who taps the button twice doesn't see an error.

Abuse posture: this is a write endpoint that takes an email and writes
to the DB. Hardening considerations:
  - Email shape is gated by a DB CHECK constraint (migration 065).
  - Per-row write is bounded by the unique constraint (same email +
    same scheduled_for can only land one row).
  - We do NOT rate-limit per-IP here; a future rate-limit middleware
    can wrap the route without a code change. For an MVP, the unique
    constraint + DB CHECK are enough — an attacker can spam different
    emails but can't blow up the table fast.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from db.supabase import get_client
from api.routes.projects import resolve_project_uuid

router = APIRouter()


class LiveReminderSubscribe(BaseModel):
    email: EmailStr


@router.post("/projects/{project_id}/live-reminders")
async def subscribe_live_reminder(
    project_id: str,
    body: LiveReminderSubscribe,
):
    """Subscribe a customer email to a one-shot reminder when this
    project's scheduled_live_at fires. Returns {ok: True, ...}.

    Validation:
      - Project must exist and not be soft-deleted.
      - Project must have a scheduled_live_at in the future. If the
        merchant hasn't scheduled or the time has already passed,
        we return 409 — no point storing a reminder we'll never send.

    Snapshot semantics: the reminder row records the scheduled_for
    value AT SIGNUP TIME. If the merchant later reschedules, the row
    still fires for the original time (a customer who signed up for
    a 5pm Tuesday show shouldn't suddenly receive a "we're live!"
    email for a 9am Wednesday slot they didn't opt into).
    """
    supabase = get_client()

    # Storefront URLs are slug-addressed (e.g. /project/website-designer),
    # and the slug is forwarded verbatim into this path param. The prior
    # .eq("id", project_id) call ran the slug against the UUID column and
    # raised Postgres 22P02 — an uncaught exception that surfaced as 503
    # on the Railway edge (response shape broken, CORS header stripped,
    # browser saw a network failure). Use the canonical resolver from
    # projects.py so both UUID and slug callers work. Also wrap the
    # follow-up SELECT in the same try/except as the INSERT so any future
    # DB hiccup returns a clean 500 with a calm detail string instead of
    # the same browser-invisible 503.
    try:
        resolved_id = resolve_project_uuid(supabase, project_id)
        if not resolved_id:
            raise HTTPException(status_code=404, detail="Project not found")

        proj_res = (
            supabase.table("projects")
            .select("id, scheduled_live_at")
            .eq("id", resolved_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not proj_res.data:
            # Resolver matched but row vanished (race with soft-delete).
            raise HTTPException(status_code=404, detail="Project not found")
        project = proj_res.data[0]
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[live-reminders] project lookup failed for project={project_id}: {exc!r}")
        raise HTTPException(
            status_code=500,
            detail="Couldn't save your reminder right now. Try again in a moment.",
        )

    # A subscription stores a scheduled_for. When the merchant has a real
    # upcoming scheduled show we snapshot that time (the cron fires it near
    # then). When there's NO upcoming schedule, we store a GENERAL
    # subscription under a far-future sentinel: the cron's time-window scan
    # never matches the sentinel, so these only ever fire via the instant
    # go-live notifier (notify_project_live_now), which emails every unsent
    # subscriber the moment the merchant actually goes live. This lets the
    # storefront offer "notify me when they go live" on every page, not
    # only when a time is posted.
    GENERAL_SENTINEL = "9999-12-31T00:00:00+00:00"
    scheduled = project.get("scheduled_live_at")
    scheduled_for: str = GENERAL_SENTINEL
    is_general = True
    if scheduled:
        try:
            scheduled_dt = datetime.fromisoformat(str(scheduled).replace("Z", "+00:00"))
            if scheduled_dt > datetime.now(timezone.utc):
                # Real upcoming show — snapshot its time (existing behavior).
                scheduled_for = scheduled
                is_general = False
        except ValueError:
            # Malformed column value — fall through to a general subscription.
            pass

    customer_email = body.email.strip().lower()

    try:
        supabase.table("live_reminders").insert({
            "project_id": project["id"],
            "customer_email": customer_email,
            "scheduled_for": scheduled_for,
        }).execute()
        return {
            "ok": True,
            "already_subscribed": False,
            "scheduled_for": scheduled_for,
            "general": is_general,
        }
    except Exception as exc:
        # Supabase-py raises an APIError for 23505 unique violations.
        # The duplicate case is the most common one (customer tapping
        # the button twice) — translate it into a success so the UI
        # doesn't show a red error for a benign action.
        msg = str(exc).lower()
        if "duplicate key" in msg or "uq_live_reminders_subscription" in msg or "23505" in msg:
            return {
                "ok": True,
                "already_subscribed": True,
                "scheduled_for": scheduled_for,
                "general": is_general,
            }
        # Anything else is a real failure — surface a calm message.
        print(f"[live-reminders] insert failed for project={project_id}: {exc!r}")
        raise HTTPException(
            status_code=500,
            detail="Couldn't save your reminder right now. Try again in a moment.",
        )
