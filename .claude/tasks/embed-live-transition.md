# Task: embed-live-transition

## Goal
A visitor already on a merchant's website sees the bubble come ALIVE
(video mounted, ring lit) within one poll tick of the shop going
live — no reload required. Verified failure 2026-07-15: going live
never mounted the video for visitors who loaded the page while the
shop was offline; iPhone Safari's bfcache made the stale state
near-permanent, Android recovered only via manual refresh.

## Root cause
embed.js builds the bubble interior ONCE at render time: the live
IVS preview iframe (+ drag zones) mount only `if (isLive)` at boot.
The 3s poll toggles the .is-live class (ring/pill chrome) but never
mounts or unmounts the video iframe.

## Scope
1. `frontend/public/embed.js` ONLY.
2. Extract the live-interior construction (iframe + drag zones)
   into mount/teardown functions inside the bubble closure.
3. Poll transition logic: is_live true → mount; false → teardown.
4. Boot path unchanged in behavior (live-at-load mounts as today).

## WHAT NOT TO DO
- No polling-frequency changes
- No visual changes to the bubble chrome
- Do not break: iOS in-frame unmute (#589), drag zones, schedule
  pill, viewer-count painter
- No changes to React pages

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
