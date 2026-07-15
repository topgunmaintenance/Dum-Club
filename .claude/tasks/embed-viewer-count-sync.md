# Task: embed-viewer-count-sync

## Goal
The embed never shows two different watching counts at once.
Verified 2026-07-15 on topgunmaintenance.com: countdown-banner chip
said "7 WATCHING" while the bubble pill said "4 WATCHING" — both
real reads of the same backend number, fetched at different moments
and never re-synced.

## Scope
1. `frontend/public/embed.js` ONLY.
2. One shared viewer-count state in the embed script; both chips
   (the bubble pill `.dum-bubble-viewers` and the banner chip
   `[data-dum-embed-product-viewers]`) render from it.
3. Single refresh path updates that state (whichever existing
   fetch/message is freshest — the bubble-live-state postMessage or
   the embed-config poll); both chips repaint together.
4. Keep the existing honesty rule: hidden entirely when the count
   is 0/unknown. Never invent or pad the number.

## WHAT NOT TO DO
- No new endpoints; reuse the existing viewer_count sources
- No visual changes to either chip
- No polling-frequency increase (don't hammer the backend for a
  cosmetic fix)

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
