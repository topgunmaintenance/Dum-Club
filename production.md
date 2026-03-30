# Production Rules for Dum Club

## Deployment Architecture

| Service | Platform | Branch | Root Dir |
|---------|----------|--------|----------|
| Frontend | Vercel | `main` | `frontend/` |
| Backend | Railway | `main` | `backend/` |
| Database | Supabase | N/A | N/A |
| Payments | Stripe | N/A | N/A |

---

## Deployment Alignment Rule (CRITICAL)

No feature or bug fix is complete unless all environments are aligned:
- GitHub `main`
- Vercel frontend deployment
- Railway backend deployment

If frontend is newer than backend, or backend is newer than frontend, the system is considered **unstable**. Stop feature work and resolve the mismatch first.

---

## Required Verification After Any Backend Change

Before declaring a backend-related issue fixed:
1. Confirm latest GitHub `main` commit hash
2. Confirm Vercel deployed commit
3. Confirm Railway active deployment commit
4. Ensure commits are aligned for the relevant frontend/backend change set

If not aligned: stop feature work, resolve deployment mismatch first.

## Required Verification After Any Frontend Change

Before declaring a frontend-related issue fixed:
1. Confirm Vercel deployed the intended commit
2. Confirm API target points to correct backend environment
3. Confirm browser is not showing stale cached behavior

---

## Critical Flows

These flows must always be re-verified after relevant changes. Full checklists in `marketplace-checklist.md`.

### Create Offer
Button fires -> validation works -> backend route executes -> offer row inserted -> UI refreshes -> new offer visible after full page refresh.

### Buy Offer / Checkout
Checkout session created -> redirect works -> webhook processed -> order row created -> quantity_sold increments -> sold-out logic correct -> owner and public pages both reflect update.

### Token Buy/Sell
Buy request executes -> sell request executes -> trade row inserted -> market state updates -> price/market cap/last trade update -> trade history refreshes -> no contamination with offers flow.

---

## No Silent Failure Rule

User-triggered flows must never fail invisibly. Every failure must produce:
- frontend feedback (error message, toast, or inline state)
- useful backend log with tagged prefix
- actionable error detail (not `[object Object]` or generic 500)

---

## Freeze Rule

After stabilizing a critical flow:
- freeze it
- do not refactor it during unrelated work
- if a later task touches it, re-run its checklist

---

## Release Gate

Do not call anything release-ready unless:
- [ ] deployment aligned (GitHub, Vercel, Railway on same commit set)
- [ ] critical checklists pass (`marketplace-checklist.md`)
- [ ] no known blocker bugs remain
- [ ] logs show expected route behavior
