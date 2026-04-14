# DUM Points System

> STATUS (Phase 0 — April 2026): This subsystem is
> technically active but de-emphasized in the current
> product direction. See CLAUDE.md v5.0 for current
> positioning. Do not surface these features in UI
> until phase unlock conditions are met.

## Earning

| Action | Amount |
|--------|--------|
| Create a business | +25 |
| Add an offer | +5 |
| Make a purchase | +2 |
| Receive a purchase | +2 |
| Referral signup (referrer) | +25 |
| Referral signup (new user) | +10 |

## Buying

- $10 → 100 points
- $25 → 275 points (10% bonus)
- $50 → 600 points (20% bonus)
- Via Stripe in DUM Hub Points tab

## Claiming

- Claimable = total earned - total already claimed
- Stripe purchases NOT claimable (instant balance top-ups)
- Claim All button: claims exact claimable amount
- Minted as SPL tokens on Solana devnet (or DB fallback)
- Claim history with explorer tx links

## Spending

- 10 points = 10% off any offer at checkout
- Works across all businesses

## Key files

- Backend: backend/api/routes/dum_points.py
- Frontend: frontend/app/hub/page.tsx

## Tables

- users.dum_balance: current balance
- dum_transactions: full history (amount, reason, reference_id, balance_after)

## Visual distinction

- Buy lane: sky-400 (blue) — instant, card, Stripe
- Claim lane: emerald-400 (green) — earned, wallet, on-chain
