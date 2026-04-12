## Today's Single Task

DUM Points confirmation — after Stripe checkout
completes in the live flow, show a prominent inline
confirmation: "You earned X DUM Points"

## Exactly What To Do

1. Read the current code fresh. Identify:
     - Where Stripe checkout completion is handled
       in the live flow
     - What currently happens after purchase
     - What data is available at that point
       (specifically: DUM Points earned)
   Use current code as the source of truth.

2. Report the current handling before touching anything:
     - What triggers post-purchase state
     - Whether DUM Points earned amount is available
       on the frontend after checkout
     - What the user sees right now after buying

3. Add a prominent inline DUM Points confirmation:

   After Stripe checkout completes in the live flow:
     Show "You earned X DUM Points" prominently
     Must appear within 10 seconds of purchase
     Must be visible without navigating away
     from the live stream page
     Should auto-dismiss after 8-10 seconds
     Should be visually distinct from sale toasts
     (different color, position, or style)

4. Do not change:
     The LiveChatIVS component internals
     The IVS video component internals
     The checkout or Stripe logic
     The webhook handler
     Any backend code unless absolutely required
     The layout or energy layer from previous tasks

5. After the change verify:
     Points confirmation appears after purchase
     Shows correct point amount
     Appears within 10 seconds
     Visible in the live view without navigation
     Auto-dismisses
     Does not conflict with sale toasts
     TypeScript type-check passes

## What Done Looks Like

After buying during a live stream the viewer sees:
  "You earned X DUM Points" confirmation
  within 10 seconds, without leaving the page
Confirmation is visually prominent and distinct
Auto-dismisses after timeout
No regressions in layout, toasts, checkout, or chat
TypeScript passes. Smoke tested.

## What Not To Do

Do not touch the layout structure
Do not touch the energy layer toasts
Do not change the webhook handler
Do not change any backend code unless
  a frontend-only approach is impossible
Do not change any other page
This task is DUM Points confirmation only
One change. Done completely. Proven. Then next.
