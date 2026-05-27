"""
merchant_recap — weekly per-merchant recap email cron.

Runs once per week (suggested Railway cron: 0 13 * * 1 — Monday
13:00 UTC = 09:00 ET in the spring, 08:00 ET in the fall) and
sends each active merchant a one-paragraph summary of last
week's activity: number of lives, viewer-hours, sales count +
total, top offer, next scheduled live.

Suggested invocation: python -m backend.services.agents.merchant_recap

ALGORITHM

  1. Compute last_week = the ISO week that just ended.
       window_start = the previous Monday 00:00 UTC
       window_end   = this Monday 00:00 UTC (exclusive)
       recap_week   = "YYYY-WNN" label of last_week
  2. Scan merchants with stripe_connect_status='connected'.
     Skip rows whose users.email lookup fails.
  3. For each merchant:
       - Find their projects (via business_profile_id).
       - Aggregate stream_sessions where start_at in window.
       - Aggregate orders where status='paid' AND created_at
         in window (filtered by project_id).
       - Pick the top offer (by paid-order count).
       - Find the next scheduled_live_at across their projects.
  4. If lives=0 AND sales=0 AND no upcoming live: skip
     (don't email "you did nothing").
  5. Insert merchant_recap_log row with the snapshot. If the
     UNIQUE constraint fires, another run already sent this
     week's recap to this merchant — skip silently.
  6. If the insert succeeded, send the email.

DESIGN NOTES

  - Idempotency mirrors trial_reminder_log: insert log row FIRST,
    let the unique violation be the skip signal, send email second.
  - "Last week" is Mon-Sun, UTC. Approximates the merchant's local
    week well enough for a recap; precision isn't worth the
    timezone-per-merchant complexity.
  - Email is plain English, no jargon. Empty-state copy varies
    by what's missing so the tone never reads punishing.

EXIT CODES

  0  always — per-merchant errors are logged; the cron exits cleanly.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

try:
    from db.supabase import get_client
    from services.email import send_weekly_merchant_recap, EMAIL_ENABLED
except ImportError:
    _here = os.path.dirname(os.path.abspath(__file__))
    _backend_root = os.path.abspath(os.path.join(_here, "..", "..", ".."))
    sys.path.insert(0, os.path.join(_backend_root, "backend"))
    from db.supabase import get_client  # type: ignore
    from services.email import (  # type: ignore
        send_weekly_merchant_recap,
        EMAIL_ENABLED,
    )


def _previous_iso_week(now: datetime) -> tuple[datetime, datetime, str]:
    """Return (window_start, window_end, recap_week_label).

    window_start = previous Monday 00:00 UTC
    window_end   = this Monday 00:00 UTC (exclusive)
    recap_week   = 'YYYY-WNN' label for last week (ISO 8601)
    """
    # weekday(): Mon=0 ... Sun=6
    today_midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    days_since_monday = today_midnight.weekday()
    this_monday = today_midnight - timedelta(days=days_since_monday)
    last_monday = this_monday - timedelta(days=7)
    # Pick a date inside last week (Wednesday) to get its ISO week id
    # — Monday itself can fall on the prior ISO week in edge cases
    # depending on the calendar's start-of-year alignment, so Wed is
    # the safe pick.
    iso_year, iso_week, _ = (last_monday + timedelta(days=2)).isocalendar()
    label = f"{iso_year}-W{iso_week:02d}"
    return last_monday, this_monday, label


def _format_week_range(window_start: datetime, window_end: datetime) -> str:
    """Render '2026-05-19' / '2026-05-25' inclusive range as 'May 19-25'.
    If the range spans two months ('May 30 - Jun 5'), spell the second
    month out too."""
    last_day = window_end - timedelta(days=1)
    if window_start.month == last_day.month:
        return f"{window_start.strftime('%b')} {window_start.day}-{last_day.day}"
    return (
        f"{window_start.strftime('%b')} {window_start.day} - "
        f"{last_day.strftime('%b')} {last_day.day}"
    )


def _format_next_live(iso_str: str | None) -> str | None:
    """Format a UTC ISO timestamp into 'Tuesday at 5:00 PM UTC'. Returns
    None for null / unparseable input."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%A at %I:%M %p UTC").replace(" 0", " ")
    except Exception:
        return None


def _project_ids_for_merchant(sb, business_profile_id: str | None) -> list[str]:
    """Resolve the set of project ids tied to a merchant. Merchants link
    to a business_profile; projects also link to a business_profile.
    Returns [] if business_profile_id is unset."""
    if not business_profile_id:
        return []
    try:
        res = (
            sb.table("projects")
            .select("id")
            .eq("business_profile_id", business_profile_id)
            .limit(50)
            .execute()
        )
        return [r["id"] for r in (res.data or []) if r.get("id")]
    except Exception as exc:
        print(f"[merchant-recap] project resolve failed bp={business_profile_id}: {exc!r}")
        return []


def _aggregate_streams(sb, merchant_id: str, project_ids: list[str], window_start: datetime, window_end: datetime) -> tuple[int, float]:
    """Sum stream_sessions for the merchant in the window. Returns
    (lives_count, viewer_hours)."""
    try:
        res = (
            sb.table("stream_sessions")
            .select("id, total_viewer_secs")
            .eq("merchant_id", merchant_id)
            .gte("start_at", window_start.isoformat())
            .lt("start_at", window_end.isoformat())
            .limit(500)
            .execute()
        )
        rows = res.data or []
        viewer_secs = sum(int(r.get("total_viewer_secs") or 0) for r in rows)
        return len(rows), round(viewer_secs / 3600.0, 1)
    except Exception as exc:
        print(f"[merchant-recap] stream agg failed merchant={merchant_id}: {exc!r}")
        return 0, 0.0


def _aggregate_orders(sb, project_ids: list[str], window_start: datetime, window_end: datetime) -> tuple[int, float, str | None]:
    """Sum paid orders across the merchant's projects in the window.
    Returns (sales_count, gmv_usd, top_offer_title)."""
    if not project_ids:
        return 0, 0.0, None
    try:
        res = (
            sb.table("orders")
            .select("id, offer_id, amount_paid_usd")
            .eq("status", "paid")
            .in_("project_id", project_ids)
            .gte("created_at", window_start.isoformat())
            .lt("created_at", window_end.isoformat())
            .limit(5000)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        print(f"[merchant-recap] order agg failed projects={project_ids}: {exc!r}")
        return 0, 0.0, None

    count = len(rows)
    gmv = sum(float(r.get("amount_paid_usd") or 0) for r in rows)

    # Top offer by paid-order count (ties broken arbitrarily — the
    # weekly recap is friendly UI, not accounting truth).
    offer_counts: dict[str, int] = {}
    for r in rows:
        oid = r.get("offer_id")
        if oid:
            offer_counts[oid] = offer_counts.get(oid, 0) + 1

    top_offer_title: str | None = None
    if offer_counts:
        top_offer_id = max(offer_counts, key=lambda k: offer_counts[k])
        try:
            offer_res = (
                sb.table("offers")
                .select("id, title")
                .eq("id", top_offer_id)
                .limit(1)
                .execute()
            )
            if offer_res.data:
                top_offer_title = (offer_res.data[0].get("title") or "").strip() or None
        except Exception as exc:
            print(f"[merchant-recap] top offer lookup failed id={top_offer_id}: {exc!r}")

    return count, round(gmv, 2), top_offer_title


def _next_live_at(sb, project_ids: list[str], now: datetime) -> str | None:
    """Return the earliest future scheduled_live_at across the merchant's
    projects, or None."""
    if not project_ids:
        return None
    try:
        res = (
            sb.table("projects")
            .select("scheduled_live_at")
            .in_("id", project_ids)
            .gte("scheduled_live_at", now.isoformat())
            .order("scheduled_live_at")
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return None
        return rows[0].get("scheduled_live_at")
    except Exception as exc:
        print(f"[merchant-recap] next-live lookup failed: {exc!r}")
        return None


def _claim_recap_slot(sb, merchant_id: str, recap_week: str, snapshot: dict) -> bool:
    """Insert merchant_recap_log. Returns True when this run owns the
    week's send; False when the UNIQUE constraint fired (another run
    already sent it)."""
    try:
        sb.table("merchant_recap_log").insert({
            "merchant_id": merchant_id,
            "recap_week": recap_week,
            **snapshot,
        }).execute()
        return True
    except Exception as exc:
        # Unique-violation is the expected dedup signal. Any other
        # exception is logged and we treat it as "lost the race" so
        # the cron doesn't send without a log row.
        msg = repr(exc).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            return False
        print(f"[merchant-recap] log insert failed merchant={merchant_id} err={exc!r}")
        return False


def run_once() -> dict:
    sb = get_client()
    now = datetime.now(timezone.utc)
    window_start, window_end, recap_week = _previous_iso_week(now)
    week_label = _format_week_range(window_start, window_end)

    counts = {"scanned": 0, "skipped_no_email": 0, "skipped_no_activity": 0,
              "claimed": 0, "sent": 0, "errored": 0}

    print(
        f"[merchant-recap] start now={now.isoformat()} "
        f"window=[{window_start.isoformat()},{window_end.isoformat()}) "
        f"recap_week={recap_week}"
    )

    try:
        merchants_res = (
            sb.table("merchants")
            .select("id, owner_privy_id, business_name, business_profile_id, "
                    "stripe_connect_status")
            .eq("stripe_connect_status", "connected")
            .limit(1000)
            .execute()
        )
    except Exception as exc:
        print(f"[merchant-recap] merchant scan failed: {exc!r}")
        return counts

    merchants = merchants_res.data or []
    counts["scanned"] = len(merchants)
    if not merchants:
        print("[merchant-recap] no connected merchants — done")
        return counts

    # Resolve emails in one trip.
    privy_ids = [m["owner_privy_id"] for m in merchants if m.get("owner_privy_id")]
    emails: dict[str, str] = {}
    if privy_ids:
        try:
            users_res = (
                sb.table("users")
                .select("privy_id, email")
                .in_("privy_id", privy_ids)
                .execute()
            )
            for u in users_res.data or []:
                if u.get("email"):
                    emails[u["privy_id"]] = u["email"]
        except Exception as exc:
            print(f"[merchant-recap] user email lookup failed: {exc!r}")

    for m in merchants:
        mid = m["id"]
        try:
            email = emails.get(m.get("owner_privy_id") or "")
            if not email:
                counts["skipped_no_email"] += 1
                continue

            project_ids = _project_ids_for_merchant(sb, m.get("business_profile_id"))
            lives_count, viewer_hours = _aggregate_streams(
                sb, mid, project_ids, window_start, window_end,
            )
            sales_count, gmv_usd, top_offer_title = _aggregate_orders(
                sb, project_ids, window_start, window_end,
            )
            next_live_iso = _next_live_at(sb, project_ids, now)

            # Skip if there's nothing to report. A merchant with zero
            # lives, zero sales, and no upcoming live doesn't want a
            # punishing "you did nothing" email.
            if (lives_count == 0 and sales_count == 0 and not next_live_iso):
                counts["skipped_no_activity"] += 1
                continue

            snapshot = {
                "lives_count": lives_count,
                "viewer_hours": viewer_hours,
                "sales_count": sales_count,
                "gmv_usd": gmv_usd,
                "top_offer_title": top_offer_title,
                "next_live_at": next_live_iso,
            }
            if not _claim_recap_slot(sb, mid, recap_week, snapshot):
                # Already sent — race or backfill. Skip silently.
                continue
            counts["claimed"] += 1

            next_live_label = _format_next_live(next_live_iso)
            ok = send_weekly_merchant_recap(
                merchant_email=email,
                business_name=m.get("business_name") or "",
                week_label=week_label,
                lives_count=lives_count,
                viewer_hours=viewer_hours,
                sales_count=sales_count,
                gmv_usd=gmv_usd,
                top_offer_title=top_offer_title,
                next_live_label=next_live_label,
            )
            if ok:
                counts["sent"] += 1
                print(
                    f"[merchant-recap] sent merchant={mid} "
                    f"lives={lives_count} sales={sales_count} "
                    f"gmv=${gmv_usd:.2f} week={recap_week}"
                )
        except Exception as exc:
            counts["errored"] += 1
            print(f"[merchant-recap] merchant {mid} failed: {exc!r}")
            # Log row may already be present — that's the right
            # behavior for at-most-once delivery.

    print(
        f"[merchant-recap] done scanned={counts['scanned']} "
        f"skipped_no_email={counts['skipped_no_email']} "
        f"skipped_no_activity={counts['skipped_no_activity']} "
        f"claimed={counts['claimed']} sent={counts['sent']} "
        f"errored={counts['errored']}"
    )
    return counts


if __name__ == "__main__":
    if not EMAIL_ENABLED:
        print(
            "[merchant-recap] EMAIL disabled (no RESEND_API_KEY). Worker "
            "will scan + claim but won't actually send. Set RESEND_API_KEY "
            "in Railway env to enable."
        )
    run_once()
    sys.exit(0)
