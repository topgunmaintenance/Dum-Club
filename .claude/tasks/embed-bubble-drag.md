# Task: embed-bubble-drag

## Goal
The floating live bubble on a merchant's own website can be moved by
touch on mobile. Today the drag surface is only the thin gold ring
(pointer events over the cross-origin video iframe never reach the
host page), so on phones the bubble is effectively stuck — verified
live on topgunmaintenance.com, Android Chrome, 2026-07-15.

## Scope
1. `frontend/public/embed.js` ONLY.
2. Add a transparent capture layer above the bubble's video iframe
   (below the dismiss × and pills) that owns pointer events:
   - drag ≥ 6px moves the bubble (reuse the existing dragState
     machinery, threshold, clamping, and localStorage persistence
     unchanged)
   - a tap (< 6px movement) falls through to the existing click
     handler that opens the overlay — same behavior as today
3. Remove (or bypass) the `target.tagName === "IFRAME"` early return
   in onPointerDown, since the capture layer now sits above the
   iframe.
4. Keep the dismiss × fully functional and NOT a drag start.
5. Test on: Android Chrome (the reported case), iOS Safari, desktop
   mouse. Tap-to-open, drag-to-move, × to dismiss, position persists
   across reload.

## WHAT NOT TO DO
- No visual redesign of the bubble; no size, ring, pill, or color
  changes
- No changes to /embed/bubble/* React pages or IVS components
- Do not break the iOS unmute tap path shipped in #589 — the tap
  fall-through must still reach the same handler

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
