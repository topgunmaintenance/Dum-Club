# Task: giveaway-mvp

## STATUS: SPEC ONLY — DO NOT BUILD YET

Blocked by, in order:
1. Realtime moves to a shared bus (Redis or Supabase Realtime).
   Today chat/timers/counts live in one worker's memory
   (backend/api/routes/auction_ws.py, WEB_CONCURRENCY=1). Giveaways
   add concurrent-connection pressure; the bus lands first.
2. Real buyer traffic exists (Phase 1 traction). Browser audit
   2026-07-02: Whatnot's giveaway energy is their network, not
   their software. Do not build this for an empty room.

## WHY

Verified on Whatnot live (isellhypestuff, 377 viewers): "Giveaway
with 197 entries" was the engagement engine of the room. It is the
one missing engagement primitive in DUM's live room (own audit,
DUM-CLUB-LAUNCH-AUDIT-2026-07-02.md).

## WHAT TO BUILD (smallest shippable version)

Host side (live studio, next to the Sell a Product controls):
- "Start a Giveaway" button: name the prize (one text field),
  pick a timer from the existing PIN_DURATION_CHOICES row
  (30 sec / 1 / 2 / 5 / 10 min).
- While running: entry count visible to host, "End early" button.
- At zero (or end-early): backend draws ONE winner uniformly at
  random from unique entrants, announces in chat as a system
  message: "<winner name> won the <prize>!" Host fulfills
  manually (hand it to them / DM them). No shipping, no payment,
  no inventory integration in v1.

Viewer side (live room, mobile + desktop):
- Banner above chat: prize name + countdown + one-tap
  "Enter" button (mint fill). Signed-in viewers only; tapping Enter
  when signed out opens the existing sign-in flow.
- One entry per user per giveaway. Button flips to "Entered".
- Winner announcement renders in chat for everyone.

## DATA

New table giveaways: id, project_id, prize_text, started_at,
ends_at, ended_early bool, winner_user_id nullable.
New table giveaway_entries: giveaway_id, user_id (unique pair),
display_name snapshot, created_at.
Winner draw is server-side, logged, and idempotent (drawing twice
returns the same winner).

## TRANSPORT

Reuse the existing auction_ws event channel for start / entry-count
/ winner events. This is exactly why the shared-bus prerequisite
exists: entries spike in bursts.

## WHAT NOT TO DO

- No follow-to-enter or comment-to-enter mechanics in v1 (one-tap
  Enter only; simplest legal/abuse surface).
- No paid entries, no points-for-entries: giveaways must never touch
  DUM Points or money (sweepstakes law: no purchase necessary).
- No multi-winner draws, no recurring giveaways, no scheduling.
- No coral except where live/urgency already uses it; the Enter
  button is mint per doctrine.
- Do not raise WEB_CONCURRENCY.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
