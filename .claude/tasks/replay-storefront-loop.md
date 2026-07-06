# Task: replay-storefront-loop

## Goal
When a shop is offline and has an enabled replay, its storefront
plays the recorded show on loop — shoppable, honestly labeled.
"The shop sells 24/7 even when the owner is asleep."

## Depends on
replay-recording-infra (playback URL + enabled toggle must exist).

## Honesty rules (doctrine, non-negotiable)
- A looping replay is NOT live. It must NEVER show the "LIVE"
  badge, the coral live color/dot, or any live viewer count.
- Label: "REPLAY" badge (or "Recorded show") in neutral/mint
  chrome, plus recorded date if space allows.
- Replays do NOT appear in the Live Now rail. They may appear on
  the storefront and, later, a separate labeled Discover rail
  (separate task; not this one).
- Real live always wins: if the shop goes live, the live stream
  replaces the replay immediately.

## Scope
1. Storefront/project page: offline state with an enabled replay
   renders the looping video (muted autoplay, loop, tap to unmute)
   in the video slot, REPLAY badge, no live chrome.
2. BUY path unchanged: pinned offer + BUY bar work exactly as they
   do live (they read storefront data, not stream data).
3. Merchant dashboard: "Loop my last show while I'm offline"
   toggle wired to the API from replay-recording-infra, plus a
   line showing what will loop (recorded date/duration).
4. CLAUDE.md doctrine update in the same commit: add the replay
   labeling rules above to §12 (founder decision 2026-07-06),
   mirroring how the demo-rail exception is documented.

## WHAT NOT TO DO
- No Discover rail changes in this task.
- No chat on replays (live chat stays live-only).
- No fake urgency on replays (no countdown unless a real pinned
  flash sale is running).
- Do not touch the live room components' live paths.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
