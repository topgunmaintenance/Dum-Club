# Task: embed-schedule-banner

## Goal
A merchant's website advertises their next live show automatically.
When the shop is offline but has a future `scheduled_live_at`, the
embed (bubble + full embed) shows a calm "LIVE THURSDAY 7PM" chip
instead of nothing. Honest, no fake urgency, no countdown theatrics.
The merchant sets the time once in the dashboard.

## Priority rule (extends bubble-showcase's rule)
LIVE always wins → else active showcase/replay video → else, if
future scheduled_live_at exists, the schedule chip → else current
offline state. The schedule chip may ALSO accompany the
showcase/replay state (small chip under the bubble) — replay plays,
chip says when the next real show is.

## Scope
1. Dashboard: a small "Next show" card — date/time picker writing
   `projects.scheduled_live_at` + a "repeats weekly" toggle writing
   `projects.recurring_weekly` (both columns already exist). Times
   entered and displayed in the shop's local timezone (hours_tz).
2. Backend: include `scheduled_live_at` + `recurring_weekly` in the
   embed-config/public payloads if not already present. When
   recurring_weekly is true and the stored timestamp is past, the
   API returns the next weekly occurrence (compute, don't mutate).
3. Embed surfaces (`frontend/public/embed.js` + the embed pages'
   offline state): render the chip from the payload. Display format:
   "LIVE THURSDAY 7PM" (same-week), "LIVE JUL 24 · 7PM" (further
   out). Neutral/mint chrome — NEVER the coral live color or LIVE
   dot (reserved for actual broadcasts, doctrine §12).
4. When the scheduled time passes without a broadcast and
   recurring_weekly is false, the chip disappears (client-side
   check; no stale "LIVE YESTERDAY").
5. Storefront parity: same chip on the /project offline view.

## WHAT NOT TO DO
- No countdown timers, no "starting soon!" pulsing, no urgency
  styling — this is a calendar note, not a sales gimmick
- No coral, no LIVE badge semantics (doctrine §12)
- No notification/reminder system in this task (no email/SMS "notify
  me" — that is its own future task)
- No Discover changes

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
