# Task: bubble-showcase

## Goal
The DUM bubble on a merchant's own website (the embed) plays their
chosen video when they're not live. One priority rule everywhere:
LIVE always wins → otherwise the merchant's active showcase/replay →
otherwise the current offline bubble state.

## Depends on
showcase-upload (active-video selection must exist).

## Scope
1. Embed surface (/embed/*): when the shop is offline and an active
   video exists, the bubble advertises it honestly — "▶ Watch" state
   with a "VIDEO" or "REPLAY" tag (per source), NEVER the live pill
   or coral. Tapping opens the existing embed experience with the
   video playing (muted autoplay, tap for sound), BUY path intact.
2. Storefront parity: /project/* offline view uses the same active-
   video rule (replay-storefront-loop shipped the player; this task
   just points it at the ACTIVE row instead of the replay row).
3. Public API: extend the embed-config/storefront payloads with the
   active video (url, source, recorded_at) so both surfaces read one
   field.
4. Viewer-hours: the embed player emits the same heartbeats tagged
   by source (hands off to replay-viewer-hour-metering — do not
   build metering here).

## WHAT NOT TO DO
- Never present recorded video as live anywhere (doctrine §12)
- No autplay-with-sound; muted until tap
- No changes to the live path of the embed
- No Discover changes

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
