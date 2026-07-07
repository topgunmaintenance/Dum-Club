"""
trial_reminders — daily cron worker for 30-day trial reminder emails.

Runs once per day (Railway cron, 09:00 America/New_York). Scans the
merchants table for non-grandfathered rows whose trial_ends_at falls
within the T-14, T-7, or T-1 reminder windows and sends the matching
email via Resend. Idempotency is enforced by trial_reminder_log's
UNIQUE (merchant_id, reminder_type) constraint — we insert the log row
BEFORE calling the email sender so a successful insert proves we're
the first to claim this reminder slot. A unique-violation means another
run (or webhook) already sent it; we skip silently.

Conversion confirmation + payment-failed emails are fired from the
Stripe webhook handler in checkout.py, not from this cron, since
those events are pushed in real time. This file still owns those
templates' wiring (insert-log-then-send) via send_reminder_once() so
the idempotency rule is consistent across cron + webhook paths.

Execution:
  python -m backend.services.agents.trial_reminders

Exit codes:
  0  always — failures are per-merchant and logged; cron does not
      retry the whole job. Per-merchant retries are not safe (Stripe
      send + insert ordering would break).

Founding-merchant safety: every merchant fetched here is filtered by
grandfathered = false. The grandfather flag was backfilled true on
migration 043 for every existing founding_merchant=true row, and the
signup path in merchant.py sets it for every new founding signup. So
no founding shop ever appears in this query.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

# Allow `python -m backend.services.agents.trial_reminders` from repo root.
# When invoked that way the backend/ package is already importable. When
# someone runs `python trial_reminders.py` directly from inside the agents
# dir, fall back to inserting the backend/ root on sys.path so the
# imports below still resolve.
try:
    from db.supabase import get_client  # noqa: E402
    from services.email import (  # noqa: E402
        send_trial_t_minus_14,
        send_trial_t_minus_7,
        send_trial_t_minus_1,
        send_trial_conversion_confirmed,
        send_payment_failed_notice,
    )
except ImportError:
    _here = os.path.dirname(os.path.abspath(__file__))
    _backend_root = os.path.abspath(os.path.join(_here, "..", "..", ".."))
    sys.path.insert(0, os.path.join(_backend_root, "backend"))
    from db.supabase import get_client  # noqa: E402
    from services.email import (  # noqa: E402
        send_trial_t_minus_14,
        send_trial_t_minus_7,
        send_trial_t_minus_1,
        send_trial_conversion_confirmed,
        send_payment_failed_notice,
    )


# How close the T-N window has to be for us to fire that reminder.
# Half-day either side absorbs cron-timing drift without overlapping
# adjacent reminders.
WINDOW_HOURS = 12


# Plan-label lookup so the email subject lines + bodies read in dollars
# not Stripe ids. Mirrors backend/api/routes/merchant.py:_PRICE_LABEL_FROM_ENV.
# Source of truth for tier prices: CLAUDE.md v5 §3.
_PRICE_USD_FROM_ENV = {
    os.getenv("STRIPE_PRICE_ID_STARTER"): 39,
    os.getenv("STRIPE_PRICE_ID_GROWTH"): 99,
    os.getenv("STRIPE_PRICE_ID_PRO"): 299,
}


def _plan_price_for(price_id: Optional[str]) -> int:
    """Map a stored Stripe Price id to the plain dollar amount we show
    in the email body. Falls back to the Growth-tier default ($99) if
    the id isn't recognised — better than rendering "$0/month" or
    silently failing the send."""
    if price_id and price_id in _PRICE_USD_FROM_ENV:
        return _PRICE_USD_FROM_ENV[price_id]
    return 99


def _format_date(iso_ts: str) -> str:
    """Render an ISO timestamp as 'May 15, 2026' for email bodies."""
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        return dt.strftime("%B %-d, %Y")
    except Exception:
        return iso_ts


def _claim_reminder_slot(merchant_id: str, reminder_type: str) -> bool:
    """Insert the log row first. Returns True if this run is the one
    that should send the email (no row existed previously), False if
    the unique constraint blocked us (already sent by an earlier run
    or the webhook). Never raises."""
    sb = get_client()
    try:
        sb.table("trial_reminder_log").insert({
            "merchant_id": merchant_id,
            "reminder_type": reminder_type,
        }).execute()
        return True
    except Exception as exc:
        # The supabase-py client raises on unique violation. We treat
        # ANY insert failure as "already sent / skip" rather than
        # erroring the whole cron run.
        print(
            f"[trial-reminders] skip {reminder_type} for merchant={merchant_id} "
            f"(log insert failed: {type(exc).__name__})"
        )
        return False


def send_reminder_once(
    merchant_id: str,
    reminder_type: str,
    send_fn,
    *args,
) -> bool:
    """Insert-log-then-send. The single idempotent code path used by
    both this cron and the webhook handlers in checkout.py. Returns
    True only when we both claimed the slot and the send actually
    fired (regardless of Resend success)."""
    if not _claim_reminder_slot(merchant_id, reminder_type):
        return False
    try:
        send_fn(*args)
        return True
    except Exception as exc:
        # If the send blew up after we wrote the log, leave the log
        # row in place. We won't auto-retry — operationally we'd
        # rather miss a reminder than spam.
        print(
            f"[trial-reminders] send {reminder_type} merchant={merchant_id} "
            f"FAILED after log: {type(exc).__name__}: {exc}"
        )
        return False


def _find_due_merchants(target_days: int) -> list[dict]:
    """Find merchants whose trial ends `target_days` days from now
    (within ±WINDOW_HOURS). Filters out grandfathered rows and rows
    without an email. Email lookup uses the cached users.email field
    populated by /api/auth/sync."""
    now = datetime.now(timezone.utc)
    window_start = now + timedelta(days=target_days, hours=-WINDOW_HOURS)
    window_end = now + timedelta(days=target_days, hours=WINDOW_HOURS)

    sb = get_client()
    # Pull merchant rows whose trial_ends_at lands in the window. Then
    # join (manually) to users.email so we have the To: address.
    merchants_res = (
        sb.table("merchants")
        .select("id, owner_privy_id, business_name, subscription_price_id, "
                "trial_ends_at, grandfathered, subscription_status")
        .eq("grandfathered", False)
        .gte("trial_ends_at", window_start.isoformat())
        .lte("trial_ends_at", window_end.isoformat())
        .execute()
    )
    rows = merchants_res.data or []
    if not rows:
        return []

    # Resolve emails in one trip rather than one-per-merchant.
    privy_ids = [r["owner_privy_id"] for r in rows if r.get("owner_privy_id")]
    emails: dict[str, str] = {}
    if privy_ids:
        users_res = (
            sb.table("users")
            .select("privy_id, email")
            .in_("privy_id", privy_ids)
            .execute()
        )
        for u in users_res.data or []:
            if u.get("email"):
                emails[u["privy_id"]] = u["email"]

    enriched = []
    for r in rows:
        # Only include trialing/active subscriptions — paused / cancelled
        # / past_due rows shouldn't get countdown emails.
        if r.get("subscription_status") not in ("trialing", "active"):
            continue
        email = emails.get(r.get("owner_privy_id") or "")
        if not email:
            print(
                f"[trial-reminders] WARNING skip merchant={r['id']} "
                f"T-{target_days}: no email on file"
            )
            continue
        r["_email"] = email
        enriched.append(r)
    return enriched


def _send_countdown(target_days: int, reminder_type: str, send_fn) -> int:
    """Dispatch one batch (T-14, T-7, or T-1) and return the number
    of emails actually sent in this run."""
    sent = 0
    for m in _find_due_merchants(target_days):
        plan_price = _plan_price_for(m.get("subscription_price_id"))
        end_date = _format_date(m["trial_ends_at"])
        ok = send_reminder_once(
            m["id"],
            reminder_type,
            send_fn,
            m["_email"],
            m.get("business_name") or "",
            plan_price,
            end_date,
        )
        if ok:
            sent += 1
            print(
                f"[trial-reminders] sent {reminder_type} merchant={m['id']} "
                f"plan=${plan_price}/mo end={end_date}"
            )
    return sent


def _sweep_expired_grace_periods() -> int:
    """Move merchants from past_due to suspended when their 3-day grace
    period has elapsed without an invoice.paid recovery. Returns the
    number of rows flipped.

    Idempotent: a second run on the same merchant is a no-op because
    the WHERE clause requires subscription_status='past_due'.

    Founding-merchant safety: grandfathered rows never have a
    grace_period_ends_at set in the first place (the webhook handler
    populates it only when invoice.payment_failed lands on a
    stripe_subscription_id, and grandfathered rows have none).
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    sb = get_client()
    try:
        res = (
            sb.table("merchants")
            .select("id, owner_privy_id")
            .eq("subscription_status", "past_due")
            .lt("grace_period_ends_at", now_iso)
            .execute()
        )
    except Exception as exc:
        print(f"[trial-reminders] suspend sweep query failed: {exc!r}")
        return 0
    rows = res.data or []
    if not rows:
        return 0
    ids = [r["id"] for r in rows]
    try:
        # Re-check subscription_status='past_due' in the UPDATE so a
        # Stripe webhook that recovers a merchant to 'active' between
        # the SELECT above and this UPDATE doesn't get clobbered back
        # to suspended. Without this filter, a payment that lands a
        # few hundred ms before the cron runs would still be punished.
        sb.table("merchants").update({
            "subscription_status": "suspended",
        }).eq("subscription_status", "past_due").in_("id", ids).execute()
    except Exception as exc:
        print(f"[trial-reminders] suspend sweep update failed: {exc!r}")
        return 0
    for r in rows:
        print(
            f"[trial-reminders] suspended merchant={r['id']} "
            f"(grace period elapsed without payment recovery)"
        )
    return len(rows)


def run() -> dict:
    """Entrypoint for `python -m backend.services.agents.trial_reminders`."""
    print(f"[trial-reminders] start at {datetime.now(timezone.utc).isoformat()}")
    t14 = _send_countdown(14, "t_minus_14", send_trial_t_minus_14)
    t7 = _send_countdown(7, "t_minus_7", send_trial_t_minus_7)
    t1 = _send_countdown(1, "t_minus_1", send_trial_t_minus_1)
    suspended = _sweep_expired_grace_periods()
    total = t14 + t7 + t1
    print(
        f"[trial-reminders] done. sent total={total} "
        f"(t-14={t14}, t-7={t7}, t-1={t1}) suspended={suspended}"
    )
    return {
        "sent_total": total,
        "t_minus_14": t14,
        "t_minus_7": t7,
        "t_minus_1": t1,
        "suspended_today": suspended,
    }


if __name__ == "__main__":
    run()
