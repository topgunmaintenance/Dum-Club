"""
schedule_rollforward — periodic worker for projects.recurring_weekly.

After a scheduled_live_at timestamp passes for a merchant who opted into
recurring weekly, this worker advances scheduled_live_at by +7 days
(repeatedly, until the new value is in the future) so the storefront's
"Going live..." banner shows the next upcoming slot without merchant
intervention.

Suggested Railway cron: 0 * * * * (hourly is enough — the storefront
banner already hides past-time values, so up to 1 hour of "Going live
yesterday at 5pm" pre-rollforward is acceptable).

Suggested invocation: python -m backend.services.agents.schedule_rollforward

ALGORITHM

  1. Scan projects WHERE recurring_weekly = TRUE
       AND scheduled_live_at IS NOT NULL
       AND scheduled_live_at < now
  2. For each row: compute new = scheduled_live_at + N weeks where N
     is the smallest integer that puts the result strictly in the
     future. Catches projects whose worker was paused for several
     weeks without spamming +7 in a tight loop.
  3. Update only that one column. No churn on updated_at.

SAFETY

  - One UPDATE per row. The recurring_weekly flag stays TRUE; the
    merchant explicitly opted in.
  - Concurrent workers race safely: each one sees a different
    scheduled_live_at value after an UPDATE, and the WHERE clause
    on scheduled_live_at < now self-deduplicates.
  - No DELETE, no DROP — never destructive.

EXIT CODES

  0 always — per-row failures logged, batch continues.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

try:
    from db.supabase import get_client
except ImportError:
    import os
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    from db.supabase import get_client  # type: ignore


def _advance_to_future(iso_str: str, now: datetime) -> str:
    """Return the smallest scheduled_live_at + N*7d that is strictly in
    the future. Handles workers that have been paused for several weeks
    without producing a tight +7 loop on the cron."""
    dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    if dt > now:
        return dt.isoformat()  # already future; shouldn't happen given the query, but safe
    delta = now - dt
    # Number of full weeks elapsed since the schedule. +1 puts us
    # strictly in the future on the next weekly anniversary.
    weeks_elapsed = (delta.days // 7) + 1
    new_dt = dt + timedelta(weeks=weeks_elapsed)
    return new_dt.isoformat()


def run_once() -> dict:
    sb = get_client()
    now = datetime.now(timezone.utc)
    counts = {"scanned": 0, "rolled": 0, "errored": 0}

    try:
        due = (
            sb.table("projects")
            .select("id, scheduled_live_at")
            .eq("recurring_weekly", True)
            .not_.is_("scheduled_live_at", "null")
            .lt("scheduled_live_at", now.isoformat())
            .limit(500)
            .execute()
        )
    except Exception as exc:
        print(f"[schedule-rollforward] scan failed: {exc!r}")
        return counts

    rows = due.data or []
    counts["scanned"] = len(rows)
    if not rows:
        print(f"[schedule-rollforward] now={now.isoformat()} — 0 due")
        return counts

    for row in rows:
        pid = row["id"]
        try:
            new_iso = _advance_to_future(str(row["scheduled_live_at"]), now)
            sb.table("projects").update({
                "scheduled_live_at": new_iso,
            }).eq("id", pid).execute()
            counts["rolled"] += 1
        except Exception as exc:
            counts["errored"] += 1
            print(f"[schedule-rollforward] project {pid} failed: {exc!r}")

    print(
        f"[schedule-rollforward] now={now.isoformat()} "
        f"scanned={counts['scanned']} rolled={counts['rolled']} "
        f"errored={counts['errored']}"
    )
    return counts


if __name__ == "__main__":
    run_once()
    sys.exit(0)
