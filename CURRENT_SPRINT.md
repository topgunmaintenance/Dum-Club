## Goal
Make the live commerce viewer experience feel like
entertainment — not a form. The layout, the energy,
and the feedback loop must all work together before
we show this to a single merchant or buyer.

The webhook is hardened. DUM Points work. Stripe works.
The infrastructure is solid. Now the experience has
to match it.

## Context
Stack confirmed working:
  Stripe webhook hardened (commit ec3a81c)
  DUM Points awarded on purchase
  Idempotency in place
  IVS live streaming wired (requires AWS env vars)
  Stripe checkout works in live flow
  WebSocket broadcasts item_sold events in real time

What is broken or missing:
  Chat is always below video — never beside it
  On mobile viewer must scroll past video + product
  to even see chat — kills engagement entirely
  No energy layer — no purchase animations,
  no urgency signals, no visual momentum
  Camera-first seller flow does not exist —
  seller must navigate to project page first
  DUM Points not prominently shown in live flow
  after a successful purchase

## Must Finish This Week

1. LAYOUT FIX — Chat beside video on desktop
   Split the live viewer page into two columns:
   Left: video stream (dominant)
   Right: chat (always visible, no scroll needed)
   Use md: breakpoint if both columns remain
   usable and clean at that width.
   If md: produces a squished or unusable layout
   use the smallest breakpoint that preserves
   a clean video + chat experience.
   Chat must never be buried below anything
   on desktop or tablet.

2. LAYOUT FIX — Mobile viewer layout
   Video top (full width)
   Chat immediately below video
   Pinned product / buy button as a sticky bar
   fixed to bottom of screen — always visible
   Sticky bar must respect bottom safe area
   and must not cover chat input or any
   critical interactive controls
   Viewer should never need to scroll to see
   chat or to buy

3. ENERGY LAYER — purchase animation
   When item_sold WebSocket event fires:
   Show a visual burst or pop in the stream area
   "Jordan just bought — 3 sold this show"
   This already fires in chat — make it visual
   Large enough to create urgency for other viewers

4. DUM POINTS CONFIRMATION — post-purchase
   After Stripe checkout completes in live flow
   show a prominent inline confirmation:
   "You earned 180 DUM Points"
   Must appear within 10 seconds of purchase
   Must be visible without navigating away

## Do Not Touch This Week

  Stripe webhook handler — already hardened
  DUM Points award logic — already working
  Auth system — do not touch
  Backend routes — do not touch unless a
    frontend fix absolutely requires a new endpoint
  IVS stage provisioning or AWS config
  Merchant onboarding or POS webhook flows
  Delivery system
  Greeter device endpoints
  Solana claim or wallet connection UI
  Project creation flow
  Any page outside the live viewer experience

## Definition of Done

On desktop and tablet:
  Video is on the left
  Chat is on the right
  Both visible simultaneously without scrolling
  Layout is clean and usable — not squished
  A purchase event shows a visual energy signal

On mobile:
  Video at top full width
  Chat immediately below video
  Buy button pinned and always visible
  Sticky bar respects iPhone safe area
  Does not cover chat input or critical controls
  No scrolling required to see chat or buy

After purchase:
  DUM Points earned appear within 10 seconds
  Confirmation is visible in the live view
  No page navigation required to see it

TypeScript type-check passes.
No broken builds.
No regressions in checkout, auth, or rewards.
Smoke tested on desktop and mobile viewport.
