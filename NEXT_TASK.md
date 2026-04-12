## Today's Single Task

Fix the live viewer layout so chat appears beside
the video on desktop and immediately below the
video on mobile.

## Exactly What To Do

1. Read the live viewer page component fresh.
   Do not rely on any previously noted line numbers —
   they drift and may no longer be accurate.
   Identify the current layout containers for:
     - video stream
     - pinned product / buy area
     - chat component
   Use current code as the source of truth.

2. Report the current layout structure before
   touching anything:
     - what wraps the video
     - what wraps the chat
     - what breakpoints currently control layout
     - why chat ends up below video today

3. Restructure the layout as follows:

   Desktop and tablet (md: if clean and usable,
   otherwise the smallest breakpoint that keeps
   both columns readable without squishing):
     Two-column grid
     Left column: video stream (dominant width)
     Right column: chat — always visible
     Pinned product / buy button: below video
     in left column or as overlay on video

   Mobile (below chosen breakpoint):
     Video full width at top
     Chat immediately below video
     Pinned product / buy button: sticky bar
     fixed to bottom of screen
     Must respect bottom safe area on iPhone
     Must not cover chat input or any critical
     interactive controls
     Viewer never needs to scroll to see chat
     or to buy

4. Do not change:
     The LiveChatIVS component internals
     The IVS video component internals
     The checkout or buy button logic
     Any backend code
     Any other page or component

5. After the layout change verify:
     Desktop viewport (1280px) — video left,
     chat right, both visible without scrolling
     Tablet viewport (768px) — clean two-column
     or graceful single-column if md: is too cramped
     Mobile viewport (375px) — video top,
     chat below, buy bar sticky and not covering
     any interactive elements
     iPhone safe area respected

## What Done Looks Like

Desktop: video left, chat right, both visible
Tablet: clean layout at chosen breakpoint
Mobile: video top, chat below, buy button sticky
  and safe-area compliant
No scrolling required to see chat on any viewport
TypeScript type-check passes
Files changed listed with exact reasons
Smoke test checklist provided covering all
three viewports
No regressions in checkout, auth, or rewards

## What Not To Do

Do not touch the energy layer yet — layout first
Do not touch DUM Points display yet — layout first
Do not refactor the video component internals
Do not change any backend code
Do not change any other page
Do not anchor to previously noted line numbers —
  read the current code fresh
This task is live viewer layout only
One change. Done completely. Proven. Then next.
