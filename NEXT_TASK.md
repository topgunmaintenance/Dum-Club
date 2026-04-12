## Today's Single Task

Energy layer — purchase animation during live streams.

When an item_sold WebSocket event fires, show a visual
burst or pop in the stream area.

## Exactly What To Do

1. Read the current code fresh. Identify:
     - Where item_sold events are received
     - What currently happens when item_sold fires
     - Where the video stream container is rendered
   Use current code as the source of truth.

2. Report the current handling before touching anything:
     - What component receives item_sold
     - What data is in the event payload
     - What currently happens visually

3. Add a visual purchase animation:

   When item_sold fires:
     Show a prominent visual burst or pop overlaid
     on or near the stream area.
     Text format: "{buyer} just bought — {N} sold this show"
     Animation should be large enough to create urgency
     for other viewers watching the stream.
     Should auto-dismiss after 3-5 seconds.
     Should stack or replace gracefully if multiple
     purchases happen rapidly.

4. Do not change:
     The LiveChatIVS component internals
     The IVS video component internals
     The checkout or buy button logic
     Any backend code
     The layout changes from the previous task
     The sticky buy bar on mobile

5. After the change verify:
     Animation appears when item_sold fires
     Text shows buyer name and running sold count
     Animation auto-dismisses
     Does not block video or chat interaction
     Works on both desktop and mobile viewports
     TypeScript type-check passes

## What Done Looks Like

A purchase during a live stream triggers a visible,
attention-grabbing animation near the video area.
Other viewers see social proof that creates urgency.
Animation auto-dismisses and handles rapid purchases.
No regressions in layout, checkout, or chat.
TypeScript passes. Smoke tested.

## What Not To Do

Do not touch DUM Points display yet — next task
Do not change the layout structure
Do not change any backend code
Do not change any other page
This task is energy layer only
One change. Done completely. Proven. Then next.
