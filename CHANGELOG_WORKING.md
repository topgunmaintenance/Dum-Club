# Working Changelog

Plain-English log of what changed and why. Updated each session.

---

## 2026-03-30

### Marketplace Stabilization (commits dcbc5b4, c36a499)

**Create Offer fixes:**
- Replaced silent early return in `saveOffer()` with visible validation errors (title, price, project ID)
- Fixed Pydantic 422 error parsing -- `detail` array now mapped to readable `.msg` strings instead of `[object Object]`
- Added success toast after offer creation
- Backend: wrapped Supabase insert in try/catch with tagged logging (`[offers] CREATE`)
- Backend: added logging to `list_offers` endpoint

**Buy Offer / Checkout fixes:**
- Fixed broken Stripe redirect URL on repeat purchases -- `window.location.href` included stale `?checkout=success` param, causing `?checkout=success?checkout=success` (malformed URL)
- Frontend now sends clean `origin + pathname` as success/cancel URL
- Backend now uses `urllib.parse` for URL construction instead of string concatenation
- Frontend cleans `?checkout=` param from URL via `history.replaceState` after processing
- Post-checkout refresh calls `loadSellerOrders()` unconditionally (safe no-op for non-owners)

**Token Buy/Sell stabilization:**
- Backend: wrapped all 4 DB writes (trade, market state, balance, candle) in try/catch with tagged logging (`[trade]`)
- Frontend: added console logging at each step of `executeTrade`
- Removed 4 duplicate `setTradeIsError(true)` calls

### Deployment Mismatch Found and Resolved
- Railway was running stale `main` at `7fb0ac4` (pre-stabilization)
- Feature branch `claude/fix-marketplace-bugs-IjUzg` merged to `main` via fast-forward
- `main` pushed to `origin` at `c36a499` to trigger Railway auto-deploy
- Vercel auto-deploys from `main` -- frontend was already ahead

### Risk
- Railway deployment not directly verified from CLI (no Railway API access)
- Must confirm in Railway dashboard that deploy completed with commit `c36a499`

### Next Step
- Verify Railway active deployment commit in dashboard
- Run sanity check (`sanity-check.md`) against production

---

## 2026-03-30

### Operating Rules Established
- Extended `claude.md` with operational debugging/deployment rules
- Created `production.md` -- deployment alignment and release gates
- Created `marketplace-checklist.md` -- per-flow verification checklists
- Created `debug-template.md` -- required structure for bug reports
- Created `handoff-template.md` -- required structure for session endings
- Created `sanity-check.md` -- pre-release smoke test
- Created `CHANGELOG_WORKING.md` -- this file
