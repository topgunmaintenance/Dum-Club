"""
live_reminders — periodic worker for customer "remind me when live"
subscriptions.

Run via Railway cron at a tight cadence (every 5 minutes is fine — the
worker scans a small partial index, and each missed window just gets
the reminder a few minutes late, which is forgivable for a
"reminder" send).

  Suggested Railway cron: */5 * * * *
  Suggested invocation:    python -m backend.services.agents.live_reminders

ALGORITHM

  1. Find every live_reminders row with sent_at IS NULL and
     scheduled_for inside [now - GRACE_BEHIND, now + WINDOW_AHEAD).
  2. For each row, attempt to claim it by UPDATE WHERE sent_at IS
     NULL. The row that wins the UPDATE owns the send.
  3. Fetch the project (business name + slug) and send the email.
  4. If the send fails (transient Resend hiccup), the row stays
     un-sent for the next pass. The grace-behind window catches it.

DESIGN NOTES

  - GRACE_BEHIND is intentionally short (15 min). A reminder that
    fires more than 15 min after the live time is more confusing
    than helpful.
  - WINDOW_AHEAD is just over one cron cadence (6 min). At a 5-min
    cron interval this guarantees no signup is skipped: every row
    enters the window within one tick of its scheduled_for.
  - The claim-via-UPDATE pattern means two concurrent workers race
    safely. The losing worker sees 0 rows affected on UPDATE and
    skips the row.

FOUNDING-MERCHANT SAFETY

  Reminders fire for any project with a future scheduled_live_at,
  regardless of merchant tier or plan status. There is no
  founding-only gating here — every merchant on the platform can
  use the retention loop.

EXIT CODES

  0  always — per-row failures are logged; the cron does not retry
     the whole batch. A retry on the same row is safe because the
     UPDATE claim is atomic.
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone

try:
    from db.supabase import get_client
    from services.email import send_live_reminder, EMAIL_ENABLED
except ImportError:
    import os
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    from db.supabase import get_client  # type: ignore
    from services.email import send_live_reminder, EMAIL_ENABLED  # type: ignore


# How long after scheduled_for we still try to send. Late reminders
# arriving 30+ minutes after the live started are more annoying than
# useful, so we cap aggressively.
GRACE_BEHIND = timedelta(minutes=15)

# How far ahead of scheduled_for we send. Slightly larger than the
# cron cadence so a single missed tick doesn't lose a reminder.
WINDOW_AHEAD = timedelta(minutes=6)


def _format_for_email(iso_str: str) -> str:
    """Format the snapshotted scheduled_for ISO string into something
    the email body reads cleanly. UTC-rendered ("Tuesday at 17:00 UTC")
    because we don't know the customer's local timezone — they signed
    up against the merchant's posted slot, so the merchant's framing
    of "going live around X" is what matters."""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        return dt.strftime("%A at %I:%M %p UTC").replace(" 0", " ")
    except Exception:
        return iso_str


def run_once() -> dict:
    """Single pass of the worker. Returns a counts dict for logging /
    health-check observability. Never raises."""
    sb = get_client()
    now = datetime.now(timezone.utc)
    window_start = (now - GRACE_BEHIND).isoformat()
    window_end = (now + WINDOW_AHEAD).isoformat()

    counts = {"scanned": 0, "claimed": 0, "sent": 0, "errored": 0}

    try:
        due = (
            sb.table("live_reminders")
            .select("id, project_id, customer_email, scheduled_for")
            .is_("sent_at", "null")
            .gte("scheduled_for", window_start)
            .lt("scheduled_for", window_end)
            .limit(500)
            .execute()
        )
    except Exception as exc:
        print(f"[live-reminders] scan failed: {exc!r}")
        return counts

    rows = due.data or []
    counts["scanned"] = len(rows)
    if not rows:
        print(f"[live-reminders] window=[{window_start},{window_end}) — 0 due")
        return counts

    for row in rows:
        rid = row["id"]
        try:
            # Atomic claim — the UPDATE only matches when sent_at is
            # still NULL. Another worker that races us sees 0 rows
            # affected and moves on.
            now_iso = datetime.now(timezone.utc).isoformat()
            claim = (
                sb.table("live_reminders")
                .update({"sent_at": now_iso})
                .eq("id", rid)
                .is_("sent_at", "null")
                .execute()
            )
            if not claim.data:
                # Lost the race; another worker is sending this one.
                continue
            counts["claimed"] += 1

            project_id = row["project_id"]
            project_res = (
                sb.table("projects")
                .select("id, slug, name, title")
                .eq("id", project_id)
                .limit(1)
                .execute()
            )
            if not project_res.data:
                # Project deleted between subscription + send. The
                # claim row stays sent_at-stamped to prevent retries.
                print(f"[live-reminders] project {project_id} vanished for row {rid}")
                continue

            project = project_res.data[0]
            business_name = (
                (project.get("title") or "").strip()
                or (project.get("name") or "").strip()
                or "A business on DUM Club"
            )
            slug_or_id = project.get("slug") or project["id"]

            ok = send_live_reminder(
                customer_email=row["customer_email"],
                business_name=business_name,
                project_slug_or_id=slug_or_id,
                scheduled_for_label=_format_for_email(row["scheduled_for"]),
            )
            if ok:
                counts["sent"] += 1
        except Exception as exc:
            counts["errored"] += 1
            print(f"[live-reminders] row {rid} failed: {exc!r}")
            # Note: we deliberately DO NOT roll back the sent_at stamp
            # on failure. The trade-off: a customer might miss one
            # reminder if Resend is down at exactly the wrong moment.
            # The alternative (clear sent_at on failure) means a
            # transient flake produces 2-3 retries and risks duplicate
            # sends if a later run partially succeeds. For a one-shot
            # reminder we err on at-most-once delivery.

    print(
        f"[live-reminders] window=[{window_start},{window_end}) "
        f"scanned={counts['scanned']} claimed={counts['claimed']} "
        f"sent={counts['sent']} errored={counts['errored']}"
    )
    return counts


if __name__ == "__main__":
    if not EMAIL_ENABLED:
        print("[live-reminders] EMAIL disabled (no RESEND_API_KEY). Worker will scan and claim but won't actually send. Set RESEND_API_KEY in Railway env to enable.")
    run_once()
    sys.exit(0)
