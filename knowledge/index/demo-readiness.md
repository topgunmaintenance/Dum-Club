# Demo Readiness

## Status: READY (as of latest main)

## Demo flow (60 seconds)

1. Open dum.club → show hero
2. Type an idea → show live preview
3. Click Launch → wait for generation
4. Land on project page → show offers
5. Click "Ask [Business]" → AI chat opens
6. Ask "What should I pick?" → AI recommends with real prices
7. Click offer → Stripe checkout loads
8. Show DUM Hub → balance, claim, rewards

## What works

- Homepage hero + textarea + launch
- AI business generation
- Project pages with offers
- AI Sales Assistant (real data, offer linking)
- Stripe checkout (test mode)
- DUM Hub (Points, Claim, Use, Market, Refer)
- Claim All with on-chain minting
- Balance animation on purchase

## What to avoid in demo

- Don't show the /upgrade page (redirect only)
- Don't demo token trading (simulated, not real)
- Don't click into admin/system routes
- Don't show the /chat page (separate from AI employee)

## Env vars required

See deployment-map.md — all 8 critical vars must be set.

## Pre-demo checklist

- [ ] dum.club loads
- [ ] At least 1 project with offers exists
- [ ] AI chat responds (ANTHROPIC_API_KEY set)
- [ ] Stripe checkout redirects (STRIPE_SECRET_KEY set)
- [ ] Sign in works (PRIVY_APP_ID set)
