# Dum Club Sanity Check

Run this before declaring any release stable. Every box must pass.

---

## Deployment Alignment
- [ ] GitHub `main` commit recorded: ___
- [ ] Vercel deployed commit recorded: ___
- [ ] Railway deployed commit recorded: ___
- [ ] Frontend and backend aligned on same commit set

## Create Offer
- [ ] Create one offer with valid inputs
- [ ] Refresh page and verify offer still exists
- [ ] Verify offer visible to non-owner (public view)

## Buy Offer / Checkout
- [ ] Buy one offer (or simulate checkout session creation)
- [ ] Verify order row created in DB
- [ ] Verify `quantity_sold` updated on offer
- [ ] Verify sold-out edge case works (set quantity_available = 1, buy it, confirm sold-out badge)

## Token Market
- [ ] Execute one buy trade
- [ ] Execute one sell trade
- [ ] Verify trade rows exist in `project_trades`
- [ ] Verify price and market cap updated in `project_market_state`
- [ ] Verify trade history refreshes in UI

## Cross-System Isolation
- [ ] Token trade does not change offers list
- [ ] Offer creation does not change market state
- [ ] Checkout does not change token balance

## Owner vs Public View
- [ ] Owner page reflects latest state (offers, orders, market)
- [ ] Public page reflects latest state (offers, market, trades)

---

## Fail Rule

If any checkbox fails, the release is **not stable**. Report the exact failing step.
