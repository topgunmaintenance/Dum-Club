# Task: embed-live-mobile-layout

## Goal
The embed live room on mobile reads like Whatnot or better: video
first, chat floating clean over it, one compact buy dock. Founder
decisions 2026-07-15: guest checkout (Buy never asks for sign-in);
chat sign-in is contextual (the input IS the ask); no chat label.

## Scope
1. `frontend/components/LiveChatIVS.tsx` — replace the full-width
   green "Sign in to chat" button with a "Say something..." pill
   styled identically to the real input; tapping opens the Privy
   modal (existing onRequestSignIn). Signed-in path unchanged.
2. `frontend/app/embed/[businessId]/page.tsx` —
   - remove the "Live chat · everyone sees this" label pill; chat
     messages float unlabeled over the video
   - compact buy dock: one row (title + price + countdown left,
     inline mint Buy CTA right); Sale ended / Sold out become the
     CTA slot's chip; "See all offers · N" becomes a quiet text
     link; chat overlay clearance drops 13rem -> 9.5rem
3. No backend changes; the dum.club /project live room LAYOUT is
   untouched (parity is a follow-up) — its signed-out chat pill
   improves automatically via the shared component, intended.

## WHAT NOT TO DO
- No sign-in gate on Buy (guest checkout is deliberate)
- No changes to the reaction rail, hearts, or chat transport
- No coral outside live/urgency semantics; mint for actions
- Do not touch IVSStageViewer (shared with other surfaces)

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
