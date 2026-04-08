# Working Changelog

Plain-English log of what changed and why. Updated each session.

---

## 2026-04-08

### Door A — Honest Simulated-Token Labeling (product-truth correction)

**Why.** Every project launched through `/api/launch/` receives a `SIM_`
placeholder mint address and `token_status="trading_live"`. The project
page rendered "price", "market cap", "24h volume", and buy/sell buttons
with no qualification — users could reasonably believe the token layer
was a real Solana market. It is not. Trading is a DB-only ledger in
`backend/api/routes/market.py` with a synthetic price-impact formula.

**What changed.** Additive labeling — no behavior changes in
`market.py`, `token.py`, `launch.py`, or `project_tokens.py`.

Backend:
- New `backend/services/token_mode.py` with `is_simulated_token()` and
  `token_mode()` helpers. Single source of truth.
- `token.py`, `launch.py`, `market.py`, `project_tokens.py` now return
  `is_simulated` / `token_mode` / `simulation_mode` fields on every
  response that emits `token_mint_address` or derived market data.
- `market.py::/trade` response now carries `simulation_mode: true` for
  SIM_ mints so any caller can branch on it.
- Tagged log line `[token] simulated mint issued ...` and
  `[trade] ... (simulated_ledger)` so backend logs make the demo state
  obvious.

Frontend:
- New `frontend/lib/tokenMode.ts` — `isSimulatedToken()`,
  `tokenModeLabel()`. Project page now routes every SIM_ check through
  this helper; no more inline `.startsWith("SIM_")` comparisons.
- New `frontend/components/SimulatedTokenBanner.tsx` — a persistent,
  not-dismissible amber banner explaining the demo state.
- `/project/[id]` Exchange tab:
  - `SimulatedTokenBanner` rendered above all analytics content.
  - "Advanced Analytics" header switches to "Demo analytics
    (simulated ledger)" when simulated.
  - Hero price card shows a "Demo" badge and relabels to
    "Demo price (simulated)".
  - Metric cards relabel to "Price (demo)", "Market Cap (demo)",
    "Volume 24h (demo)".
  - Stats bar gets a top strip "Demo market · simulated ledger · not
    on-chain" and per-column demo labels.
  - Buy/Sell buttons switch to "Record demo buy · $TOKEN" /
    "Record demo sell · $TOKEN" with a disclaimer below.
  - Sticky bottom bar shows a DEMO pill next to the token symbol and
    labels the buy button "Demo buy · $TOKEN".
  - The "Verified on Solana" footer (a direct falsehood for SIM_
    mints) is now "Demo mint · Not on-chain" when simulated.
- `frontend/app/page.tsx` comparison table: "DUM Points — on-chain
  loyalty" → "DUM Points — real loyalty currency" (DUM Points claim is
  DB-fallback-capable; the on-chain phrasing was too strong).

Docs:
- `product.md` "Token Role" section rewritten to open with "Current
  State" explaining SIM_ mints and the simulated ledger. "Intended
  Role" section preserved but labeled planned-not-shipped. Language
  Guidelines gain "Avoid everywhere" items and a new "Allowed when
  labeling simulated token surfaces" list.
- `README.md`: "Live token activity" bullet → "Demand-signal market
  (demo)". Token role section rewritten.
- `claude.md`: new "Simulated Token Labeling (Door A — DO NOT
  regress)" subsection under "What NOT to Build" with three hard
  rules for anyone touching this surface.

No migration. No feature flag. No new dependencies. No response fields
removed or renamed. Agent tests still pass (22/22).

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

## 2026-03-30 (Session 2)

### Webhook Root Cause Found and Fixed (commit 63dfb51)
- **Root cause**: Stripe only sent `payment_intent.succeeded` events, which carry no metadata and no session_id. The order row had `stripe_payment_intent_id = NULL` (Stripe assigns PI after session creation). All 4 lookup strategies failed silently.
- **Fix part 1**: When `payment_intent.succeeded` lookup fails, resolve the Checkout Session from Stripe via `Session.list(payment_intent=pi_id)`, then retry lookup with session_id and session metadata. Also backfill PI ID on the order row.
- **Fix part 2**: At checkout creation, copy metadata to the Payment Intent so future webhooks can find the order directly.
- Stripe webhook now subscribes to both `checkout.session.completed` AND `payment_intent.succeeded`

### Admin System Health Panel (commits a077518, 0e07e8d, 795186a, 6b134bf)
- Built `/admin/system` page with 6 health check cards (Backend, Deployment, Database, Offers, Checkout, Trading)
- Admin-only via existing `AdminRoute` + `Depends(require_admin)` — DB-driven `is_admin`
- Deployment alignment: frontend reads `VERCEL_GIT_COMMIT_SHA` via `next.config.js` env mapping, passes to backend as query param
- Checkout health check shows stuck `pending_payment` count and Stripe webhook endpoint URLs
- "Recover Orders" button checks Stripe for each stuck order and updates paid ones
- 4 stuck orders successfully recovered via admin panel

### Admin Access Audit
- Searched entire codebase for hardcoded email checks — none found
- Admin access is fully DB-driven via `users.is_admin` (backend + frontend)
- Only reference to `julian@topgunmaintenance.com` is a mailto contact link on landing page (not a permission check)

### UI Upgrade Steps 1-5
**Step 1 — Global color system + typography** (commit b9893dc)
- Added CSS custom properties (--color-bg-base, --color-bg-card, etc.)
- Added Tailwind tokens (bg-base, bg-card, bg-panel, dum-green, dum-violet)
- Replaced all 124 `bg-black` → `bg-base` across 13 files
- Removed `font-mono` from 82 non-numeric elements, kept on 158 numeric/financial elements

**Step 2 — Project page UX** (commit 8fa94d2)
- Image lightbox: click offer image → fullscreen modal, ESC to close, hover zoom
- Hero price card: emerald border glow, live pulse dot
- Offer cards: aspect-4/3 images, bg-card, hover glow
- Buy/sell panel: emerald accent border
- Orders: status dot indicators
- Trust cues: lock icon + "Secure checkout via Stripe"

**Step 3 — Landing page hero** (commit 7cbbcab)
- Rotating headline: "DESCRIBE IT." + "WE LAUNCH IT." / "AI BUILDS IT."
- Stronger CTAs: rounded-xl, hover glow
- Dual gradient background (emerald + violet)
- Larger type scale (sm:7xl lg:8xl)

**Step 4 — Discover page cards** (commit d718d83)
- Cards: bg-card, hover lift (-translate-y-1) + depth shadow
- "Open workspace →" → "View Project →" with hover color
- Reordered: name → description → badges → readiness → CTA

**Step 5 — Dashboard + AI Chat** (commit a41082e)
- Dashboard: bg-card, larger stat numbers, hover lift on cards
- AI Chat: full purple theme (25+ color swaps from green → purple #a78bfa/#7B61FF)

### Deployment State
- GitHub `main`: a41082e
- Vercel: auto-deployed
- Railway: auto-deployed

### Remaining
- Make a test purchase to confirm webhook fix works end-to-end
- Run full `sanity-check.md` against production

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
