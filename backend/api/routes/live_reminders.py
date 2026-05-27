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

    proj_res = (
        supabase.table("projects")
        .select("id, scheduled_live_at")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not proj_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = proj_res.data[0]
    scheduled = project.get("scheduled_live_at")
    if not scheduled:
        raise HTTPException(
            status_code=409,
            detail="No upcoming live show is scheduled for this business yet. Check back soon.",
        )

    # Parse the schedule as a UTC datetime so we can compare to now.
    try:
        scheduled_dt = datetime.fromisoformat(str(scheduled).replace("Z", "+00:00"))
    except ValueError:
        # If the column ever contains a malformed value (shouldn't —
        # the column is TIMESTAMPTZ) we treat it as "no schedule" so
        # the customer gets a sensible message rather than a 500.
        raise HTTPException(
            status_code=409,
            detail="No upcoming live show is scheduled for this business yet. Check back soon.",
        )

    if scheduled_dt <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=409,
            detail="That live show already started or has already passed. Refresh the page for the next one.",
        )

    customer_email = body.email.strip().lower()

    try:
        supabase.table("live_reminders").insert({
            "project_id": project["id"],
            "customer_email": customer_email,
            # Store the same ISO string the project row carries so the
            # snapshot is exact-byte traceable for support.
            "scheduled_for": scheduled,
        }).execute()
        return {
            "ok": True,
            "already_subscribed": False,
            "scheduled_for": scheduled,
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
                "scheduled_for": scheduled,
            }
        # Anything else is a real failure — surface a calm message.
        print(f"[live-reminders] insert failed for project={project_id}: {exc!r}")
        raise HTTPException(
            status_code=500,
            detail="Couldn't save your reminder right now. Try again in a moment.",
        )
