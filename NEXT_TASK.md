## Today's Single Task

Camera-first seller flow — open app and go live
in one tap. Seller should not need to navigate
to a project page first.

## Exactly What To Do

1. Read the current code fresh. Identify:
     - The current seller flow to go live
     - How many steps it takes today
     - Where the entry point currently is
     - What components handle go-live logic

2. Report the current flow before touching anything:
     - Every step a seller takes to go live
     - Where the go-live controls live in the code
     - What could be eliminated or shortened

3. Reduce the flow so a seller can go live
   in one tap from the most natural entry point.
   The seller should not need to navigate to
   a project page first.

4. Do not change:
     The LiveChatIVS component internals
     The IVS video component internals
     The checkout or Stripe logic
     The webhook handler
     The layout or energy layer from previous tasks
     The DUM Points confirmation toast

5. After the change verify:
     Seller can go live faster than before
     Existing go-live flow still works
     No regressions in layout, toasts, checkout
     TypeScript type-check passes

## What Done Looks Like

A seller can open the app and go live
without navigating to a project page first.
The flow is shorter than it is today.
No regressions in any previous task.
TypeScript passes. Smoke tested.

## What Not To Do

Do not touch the layout structure
Do not touch the energy layer toasts
Do not touch the DUM Points toast
Do not change the webhook handler
Do not change any backend code unless
  a frontend-only approach is impossible
Do not change any other page unless
  the new entry point requires it
This task is camera-first seller flow only
One change. Done completely. Proven. Then next.
