# DUM Club — Live Purchase Path Audit
# Audit-only. Read-only inspection. No source files were edited.
# Date: 2026-05-01

---

## 1. Executive Summary

The Stripe-direct live purchase path is **substantially built and wired
end-to-end** in code: a Privy-authenticated buyer can hit the buy button
on `/project/[id]`, the frontend posts to
`POST /api/checkout/create-payment-intent`, the backend creates a
Stripe Checkout Session **inside the merchant's connected account**
(direct charge with `application_fee_amount`), the webhook flips the
`orders` row to `paid`, increments `quantity_sold`, awards DUM Points,
and broadcasts an `item_updated` / `item_sold` event over a
project-scoped WebSocket that the live viewer listens to.

The doctrine boundary is **respected in the checkout path**: there is
no SOL/Phantom checkout flow on the consumer purchase surface. Solana
appears only in:

- a wallet provider stack (`WalletProviders.tsx`) that wraps the app
  for read-only wallet adapters,
- `services/solana_mint.py`, used post-payment as a best-effort,
  feature-flagged DUM SPL mint (silently skipped when env vars
  aren't set),
- `/hub`, `/vault`, `/technology` consumer surfaces (out of this
  audit's scope).

**No Solana is on the buy button path.** Buying an offer goes
exclusively through Stripe.

**Primary risk:** there is no dedicated `/orders/success` page. After
Stripe redirects, the user lands back on `/project/[id]?checkout=success`
which displays a banner and schedules three polling refreshes
(2s/5s/10s) waiting for the webhook. If the webhook is slow or fails,
the buyer's UI never confirms the order. The `/orders` page exists and
lists orders by status, but it is not the redirect target.

**Secondary risk:** `GoogleSignInButton.tsx` calls
`supabase.auth.signInWithOAuth` instead of Privy. Auth is otherwise
Privy throughout. The component is not imported by any page (confirmed
by grep) — dead code, but a footgun if anyone reaches for it.

---

## 2. Current Doctrine / Scope Confirmation

Confirmed against `CLAUDE.md` v5.0:

- **Phase 0/1 payments:** Stripe Connect, Direct charges, Express
  onboarding. Platform never holds the money. (§8, §12 rule 11)
- **Solana checkout: Phase 3 locked.** Never consumer-facing. (§5,
  §12 rule 3)
- **DUM Points purchase flow: hidden** until legal review. (§5)
- **Solana may be planned/audited but not implemented now.**
- **FOUNDING_CAP = 100** sourced from `backend/api/routes/merchant.py`
  (§10).

This audit treats "live purchase flow" as: live viewer page + pinned
product + buy button → Stripe → order confirmation → real-time
inventory broadcast.

---

## 3. Frontend Findings

### 3.1 Privy provider setup — **Confirmed**

`frontend/components/AppProviders.tsx`
- Wraps the app in `<PrivyProvider>` when
  `NEXT_PUBLIC_PRIVY_APP_ID` is set; otherwise renders only
  `<WalletProviders>` (silent no-Privy fallback).
- `loginMethods: ["google", "email"]`
- `embeddedWallets.solana.createOnLogin: "users-without-wallets"` —
  Solana embedded wallet is auto-provisioned on login.
- `appearance: { theme: "dark", accentColor: "#00FFB2" }`

`frontend/lib/auth/AuthContext.tsx`
- Custom `AuthProvider` wraps Privy, exposes `useAuth()` returning
  `{ user, loading, isAdmin, login, logout, getToken }`.
- After login, posts to `POST /api/auth/sync` with
  `{ privy_id, email, embedded_wallet, linked_wallets, google_linked }`
  and stores the result.
- Stable refs prevent stale-Privy-callback bugs.
- Re-syncs once when an embedded Solana wallet is lazily provisioned
  for Google users (composite key `${user.id}:${firstWalletAddress}`).

### 3.2 AuthButton / login components — **Partially confirmed**

- `frontend/lib/auth/AuthContext.tsx` exposes `login()` that proxies
  to `usePrivy().login`. This is the canonical login entry point.
- `frontend/components/Navbar.tsx` references `user?.privyId`
  (confirmed it consumes `useAuth()`); the actual login button widget
  inside Navbar was **not opened** — Not confirmed which component
  triggers `login()`.
- `frontend/components/GoogleSignInButton.tsx` exists but uses
  **Supabase Auth (`supabase.auth.signInWithOAuth`)**, not Privy.
  Grep across the frontend shows it is **not imported anywhere** —
  dead code. Flagged as a footgun: keeping a Supabase OAuth path
  alongside a Privy stack risks accidental adoption.

### 3.3 Phantom / Solana wallet support — **Confirmed (provider-level only)**

`frontend/components/WalletProviders.tsx`
- Wraps app in `@solana/wallet-adapter-react`'s
  `<ConnectionProvider>` + `<WalletProvider>` +
  `<WalletModalProvider>`.
- Registers `PhantomWalletAdapter` and `SolflareWalletAdapter`.
- Endpoint: `NEXT_PUBLIC_SOLANA_RPC_URL` with devnet fallback.

Searched `frontend/app/**/page.tsx` for any Solana payment flow
(`useSolanaWallets`, `SystemProgram.transfer`, `solanaPay`,
`payInSol`): **no SOL checkout calls** were found from any page's
buy button. The SOL providers exist for `/hub` (DUM balance display)
and `/vault` only. **Doctrine respected.**

### 3.4 Live viewer page — **Confirmed (lives under `/project/[id]`)**

There is **no** `/live`, `/watch`, or `/stream/[id]` route. The live
viewing experience is the project page itself
(`frontend/app/project/[id]/page.tsx`) when the project's `is_live`
column flips true. Evidence:

- `pinned_offer_id`, `is_live`, `stream_url`, `live_provider`,
  `ivs_stage_arn`, `active_auction_id` are all read on the project
  page state.
- `app/project/[id]/page.tsx:2420` — `pinnedOffer = offers.find((o) =>
  o.id === project?.pinned_offer_id) || null`.
- IVS stage mounting (`IVSStageHost`, `IVSStageViewer` components
  exist in `frontend/components/`) — owner publishes, viewer
  subscribes via tokens minted by `/api/ivs/host-token` and
  `/api/ivs/viewer-token`.
- `LiveChatIVS` component opens the project-scoped WebSocket (see
  3.8).

### 3.5 Pinned product / buy button flow — **Confirmed**

In `frontend/app/project/[id]/page.tsx`:
- Owner-side pin toggle: lines 4088 and 5649 call
  `handlePinOffer(...)` against the offer ID, optimistically updating
  `project.pinned_offer_id`.
- `handlePinOffer` setter at line 2414.
- The buy button click handler (`buyOffer`) is the same code path
  whether the offer is pinned, in the offer grid, or live —
  differentiated only by the `source` field
  ("normal" / "live" / "live_auction") and an optional `auction_id`
  / `override_price`.

### 3.6 Stripe checkout flow (frontend) — **Confirmed**

`buyOffer` (`page.tsx:1250–1320`):
1. Calls `getToken()` (Privy access token).
2. Builds clean URL (`window.location.origin + pathname`) for both
   `success_url` and `cancel_url` to avoid stale query params.
3. POSTs to `${API_BASE}/api/checkout/create-payment-intent` with:
   `{ offer_id, success_url, cancel_url, use_dum_discount, source,
   auction_id?, override_price? }` and `Authorization: Bearer
   <privy-token>`.
4. On success, sets `liveLastBuyPrice` in `sessionStorage`, calls
   `capturePurchase()` for automation analytics, then
   `window.location.href = data.checkout_url` (Stripe-hosted
   Checkout).
5. Errors render inline via `setBuyError`/`setBuyStep`.

Note: payment is **never executed in-app**. The page redirects
fully to Stripe's hosted Checkout. No Stripe Elements / no card
input lives on the project page.

### 3.7 Order success page — **Not a dedicated page; inline on `/project/[id]`**

`page.tsx:2962–3010`:
- On mount, reads `?checkout=success` / `?checkout=cancelled`.
- On success: sets `checkoutResult="success"`, computes DUM Points
  to display via the formula `min(50, 10 + floor(amount/5))`
  (mirrored from the backend webhook — there is a code comment
  warning these must stay in sync).
- Schedules `loadOffers()` + `loadSellerOrders()` at 2s, 5s, and
  10s to wait for the webhook to land.
- Dispatches a `dum-points-update` window event so the navbar /
  `DumPill` refresh.
- Strips `?checkout=...` from the URL to prevent stale state on
  repeat visits.

`/orders` page (`frontend/app/orders/page.tsx`) exists and lists the
buyer's orders via `GET /api/checkout/orders/buyer`. It is **not**
the Stripe redirect target — the redirect goes back to the project
page. Status badges: `Awaiting Payment` (`pending_payment`), `Paid`
(`paid`), `Fulfilled` (`fulfilled` / `delivered`).

There is one external reference to `/orders?checkout=success` in
`frontend/lib/ai/tools/stripeLink.ts:77` as a default for the AI
agent's stripeLink tool. It is **not** what the real buy button uses
— the real flow uses `cleanUrl` (current project URL).

### 3.8 Real-time viewer updates — **Confirmed**

`frontend/components/LiveChatIVS.tsx:41–90` opens a WebSocket to
`{ws|wss}://{API_BASE}/api/auction-ws/events/{projectId}` and
handles:
- `chat` — appends to message list (200-msg sliding window).
- `viewer_count` — sets visible count.
- `item_updated` — fires `onItemUpdate(data)` callback into the
  parent project page.
- `item_sold` — fires `onItemSold(data)` and pushes a system "Item
  just sold!" message into chat.
- Auto-reconnects after 2s on disconnect.

Server protocol matches: see Backend §4.6.

---

## 4. Backend Findings

All findings inspected directly in `backend/api/routes/checkout.py`,
`backend/api/routes/auction_ws.py`, `backend/api/routes/ivs.py`,
`backend/api/routes/merchant.py`, `backend/services/solana_mint.py`,
`backend/main.py`.

### 4.1 Stripe checkout endpoint — **Confirmed**

`POST /api/checkout/create-payment-intent` —
`backend/api/routes/checkout.py:222`.

Pipeline:
1. **Auth.** `Depends(get_current_user)` → `auth.privy.get_current_user`
   verifies Privy JWT; `privy_id = current_user["sub"]`.
2. **Offer fetch.** `offers` table, must be `is_active=true`.
3. **Seller resolution.** Reads `projects.privy_id` (preferred) or
   falls back to `projects.owner_id`. Comment on lines 250–262
   explicitly explains why `privy_id` wins (matches downstream
   columns `merchants.owner_privy_id`, `users.privy_id`).
4. **Price.** `override_price` (only when `auction_id` is set)
   else `offer.price_usd`.
5. **DUM discount.** `use_dum_discount=true` AND `dum_balance ≥ 10`
   → deduct 10, credit `projects.dum_received`, apply 10% off.
   Subsidy model: customer pays discounted, seller payout is on
   original. `token_discount_applied` flag stored on the order.
   Stripe minimum is enforced: amount_cents < 50 → 400.
6. **Inventory.** Enforced only when
   `unlimited_inventory=false` AND `quantity_available > 0`. If
   `quantity_available - quantity_sold ≤ 0` → 400 sold out.
7. **Stripe Connect routing.**
   - `merchant_stripe_id = _get_seller_stripe_connect_id(...)` —
     joins `merchants` on `owner_privy_id`.
   - If no `stripe_connect_id` → 400
     `code: merchant_stripe_not_connected`.
   - `_assert_merchant_can_receive` retrieves the connected
     account and requires `charges_enabled AND payouts_enabled`.
     On false → 400 `code: merchant_stripe_not_verified` with
     `requirements_due` echoed back.
   - **Test/dev bypass** (`ENVIRONMENT=development` OR
     `STRIPE_TEST_MODE=true`) is hard-disabled when
     `STRIPE_SECRET_KEY` starts with `sk_live_` — see
     `_checkout_verification_bypass_allowed()`. This is correct.
8. **Direct charge.** `Session.create(..., stripe_account=
   merchant_stripe_id)` — the session is created **inside** the
   merchant's connected account. Platform fee:
   `application_fee_amount = round(seller_payout_base *
   PLATFORM_FEE_RATE * 100)`. `PLATFORM_FEE_RATE = 0.07` (7%).
9. **Order row insert** with `status="pending_payment"`,
   `stripe_session_id`, `stripe_payment_intent_id`.
10. **Metadata backfill.** Both the Session and the Payment Intent
    are `modify`'d (with `stripe_account=merchant_stripe_id`) to
    embed `order_id` so the webhook can find the row by metadata
    even if column lookups fail.
11. **Auction handoff.** If `auction_id` was passed, the auction
    row flips from `ended` → `awaiting_payment` with
    `winner_order_id`.
12. Returns `{ checkout_url, session_id, order_id, final_price,
    platform_fee, seller_receives }`.

**Doctrine fit:** matches §8 ("Connect account type: Express via
OAuth … Direct charges … platform takes its cut via
`application_fee_amount`"). Confirmed.

### 4.2 Stripe webhook endpoint — **Confirmed**

`POST /api/checkout/webhook` —
`backend/api/routes/checkout.py:552`.

- Requires `STRIPE_WEBHOOK_SECRET` (503 if missing).
- Verifies signature via `stripe.Webhook.construct_event`.
- **Idempotency:** checks
  `processed_webhook_events.event_id` (migration 025) before
  processing; 200 + `duplicate: true` on hit. Records the event
  after processing in the same table (best-effort try/except).
- **Order lookup strategies (in order):**
  1. `stripe_session_id`
  2. `stripe_payment_intent_id`
  3. `metadata.order_id`
  4. `metadata.offer_id + metadata.buyer_user_id` joined with
     `status IN (pending_payment, pending)` ordered by created_at
- **Events handled:**
  - `checkout.session.completed` — only acts when
    `payment_status == "paid"`. Branches on
    `metadata.purchase_type == "dum_points"` (DUM Points
    purchase: credits `users.dum_balance`, logs to
    `dum_transactions`, attempts on-chain mint via
    `services.solana_mint.mint_dum_to_wallet` if
    `is_solana_enabled()`). Otherwise routes to `_process_paid`.
  - `payment_intent.succeeded` — fallback path when the session
    event was missed; also resolves session from PI via
    `s.checkout.Session.list(payment_intent=pi_id)` and backfills
    `stripe_payment_intent_id` on the order.
  - `account.updated` — connected-account verification webhook.
    Updates `merchants.stripe_connect_status` to one of
    `verified` / `restricted` / `pending_verification` based on
    `charges_enabled && payouts_enabled && details_submitted &&
    !currently_due` (or `disabled_reason` for restricted).
- **`_process_paid` does:**
  1. Updates order to `status="paid"`.
  2. Increments `offers.quantity_sold`.
  3. Broadcasts `item_updated` + (if sold-out)
     `item_sold` over the project WebSocket via
     `broadcast_sync(project_id, ...)` from
     `auction_ws.py`.
  4. Awards DUM:
     `dum_reward = min(50, 10 + int(amount / 5))`. Updates
     `users.dum_balance` and inserts a `dum_transactions`
     row with `reason="purchase_reward"`.
  5. Sends buyer email (`send_buyer_payment_confirmed`) and
     seller email (`send_seller_new_order`). Both wrapped in
     try/except — non-blocking.

### 4.3 Order / payment state model — **Confirmed via code; schema not opened**

State machine observable from code (orders.status):
- `pending_payment` → set on session create (checkout.py:471)
- `paid` → set in `_process_paid` (checkout.py:650)
- `fulfilled` / `delivered` → set in `PATCH
  /api/checkout/orders/{order_id}/status` (checkout.py:1101)

Order row carries:
- `offer_id`, `project_id`, `buyer_user_id`, `seller_user_id`,
  `amount_paid_usd`, `platform_fee_usd`, `seller_receives_usd`
- `stripe_payment_intent_id`, `stripe_session_id`,
  `stripe_session_id`, `status`, `buyer_email`, `notes`,
  `token_discount_applied`, `source` ∈ {normal, live, live_auction}

Idempotency table: `processed_webhook_events` (event_id,
event_type) — migration 025, confirmed via filename.

Admin recovery: `POST /api/checkout/orders/recover-pending`
(checkout.py:1163, gated by `require_admin`) walks
`pending_payment` orders, calls `Stripe.checkout.Session.retrieve`
/ `PaymentIntent.retrieve`, and re-runs the paid path inline.

Note: full `orders` table DDL was **not opened**; columns above
inferred from `select(...)` and `update(...)` calls. Status
strings and column names are confirmed from code.

### 4.4 Merchant Stripe Connect verification — **Confirmed**

`backend/api/routes/merchant.py`:
- `GET /api/merchant/stripe/connect/status` (line 488) — accepts
  the merchant's Privy auth, retrieves their connected account
  via `Account.retrieve`, computes status with the same logic the
  webhook uses, writes back `merchants.stripe_connect_status`,
  returns `{ charges_enabled, payouts_enabled, details_submitted,
  currently_due, eventually_due, stripe_connect_status,
  stripe_connect_id, ... }`.
- OAuth callback at line 722 area writes
  `stripe_connect_id` and sets initial
  `stripe_connect_status="connected"`.
- Verification rules (matches checkout's gate exactly):
  `verified` requires `charges_enabled && payouts_enabled &&
  details_submitted && currently_due == []`.

The same gate is enforced both at checkout-session creation
(`_assert_merchant_can_receive`) and asynchronously via the
`account.updated` webhook. Two writes, one source of truth in
`merchants.stripe_connect_status`. Correct.

### 4.5 IVS / live stream endpoints — **Confirmed**

`backend/api/routes/ivs.py`:
- `POST /api/ivs/create-stage` — owner only. Cleans up stale
  stage if any (`delete_stage`), then `create_stage`, persists
  `ivs_stage_arn`, `ivs_stage_id`, `live_provider="ivs_realtime"`,
  `is_live=true` on `projects`. Sleeps 1s for AWS propagation
  before minting host PUBLISH token. Daily stream limit via
  `register_stream_start`.
- `POST /api/ivs/host-token` — owner only. PUBLISHER token for
  the project's stage.
- `POST /api/ivs/viewer-token` — viewer (anon allowed via
  `anon-{project_id_prefix}`). Rate-limit + viewer-cap via
  `services.live_limits`. Refuses if `is_live=false` or no
  `ivs_stage_arn`.
- `POST /api/ivs/end-stage` — owner only. `delete_stage` +
  clears `pinned_offer_id`, `live_*`, `is_live`.

Feature gate: `services.ivs_realtime.is_ivs_enabled()` reads
`ENABLE_IVS_REALTIME_BACKEND=true`. When false, every IVS
endpoint returns 503. Defaults off.

`_verify_owner` is intentionally tolerant: matches if
`owner_id == privy_id` OR `owner_id == resolved_profile_uuid`
OR `privy_id == privy_id`. Handles legacy rows.

### 4.6 WebSocket real-time item / order updates — **Confirmed**

`backend/api/routes/auction_ws.py`:
- `WS /api/auction-ws/events/{project_id}` — accept, register
  in `_connections[project_id]`, send initial
  `auction_state` (if any) and `viewer_count`, then loop on
  `receive_text`.
- Inbound message types: `ping` → `pong`; `chat` → broadcast.
  Chat is rate-limited (per-conn 0.5s `CHAT_COOLDOWN`,
  per-user `check_chat_rate`). Stream auto-ends if
  `check_stream_duration` trips.
- Outbound types: `chat`, `viewer_count`, `item_updated`,
  `item_sold`, `auction_state`, `auction_started`,
  `auction_ended`, `auction_tick`, `auction_timer_expired`,
  `bid`, `stream_expired`, `error`, `pong`.
- `broadcast_sync(project_id, event)` is the entry point used
  by the Stripe webhook (`_process_paid`) to push
  `item_updated` and `item_sold` after a paid order. It
  uses `asyncio.get_event_loop()` and `create_task` — works
  inside FastAPI's running loop.

Frontend client at `frontend/components/LiveChatIVS.tsx:50`
matches the URL: `/api/auction-ws/events/{projectId}`.

### 4.7 Solana-related backend code found — **Inventoried, none on the buy path**

- `backend/services/solana_mint.py` — base58 keypair handling,
  `is_solana_enabled()`, `mint_dum_to_wallet(wallet, amount)`
  shells out to `node scripts/create_dum_token.js mint-to ...`,
  `get_dum_balance(wallet)` reads on-chain via
  `getTokenAccountsByOwner` JSON-RPC. **All best-effort** —
  silently no-ops when env vars are missing or the keypair is
  in JSON-array form (auto-disabled at import).
- `backend/api/routes/dum_points.py` — exists (not opened in
  this audit). Not confirmed whether it exposes any
  consumer-facing purchase endpoint. Doctrine says points
  purchase is hidden.
- `backend/api/routes/checkout.py:809–842` — DUM Points
  purchase branch in the webhook (`metadata.purchase_type ==
  "dum_points"`). This handles a Stripe Checkout used to buy
  DUM Points in USD; the on-chain mint at the end is
  best-effort. **The frontend purchase flow that creates such
  a session is documented as hidden in `/hub`**; not confirmed
  in this audit whether it is reachable from any UI.
- `backend/scripts/create_dum_token.js` — Node SPL token
  scripting, called by the service above.
- No SOL-as-payment code path on the backend exists. No code
  reads `SystemProgram.transfer`, `solana_pay`, or accepts a
  signed Solana transaction as proof of purchase. Confirmed
  absent.

---

## 5. Gaps / Risks

Numbered for reference. Existing code findings only — no
recommendations bleed into this section.

1. **No dedicated post-checkout success page.** Stripe redirects
   to `/project/[id]?checkout=success`. The page polls at 2s/5s/10s
   for fresh data. If the webhook is delayed past 10s, the buyer's
   UI never affirmatively confirms the order. There is no fallback
   that reads order status directly via session_id query param.
2. **DUM Points formula duplicated across FE and BE.** Frontend
   `page.tsx:2976` computes `min(50, 10 + Math.floor(price / 5))`
   to render the celebration. Backend `checkout.py:750` computes
   `min(50, 10 + int(amount / 5))`. A code comment warns they must
   stay in sync. They are presently in sync; future-edit risk.
3. **`GoogleSignInButton.tsx` uses Supabase Auth, not Privy.** No
   importers found via grep, but the file remains in the tree and
   could be reached for by mistake. Auth doctrine is Privy-only.
4. **Order recovery is manual.** `POST /api/checkout/orders/recover-
   pending` requires admin. No automatic retry sweeper. If the
   webhook never fires (e.g. signing-secret rotated and not
   redeployed), buyers see `pending_payment` indefinitely.
5. **Inventory enforcement is opt-in.** `unlimited_inventory`
   defaults to true at read-time. A seller who sets
   `quantity_available` but leaves `unlimited_inventory=true` will
   not get sold-out enforcement. Not confirmed whether the offer-
   creation UI couples these fields.
6. **`broadcast_sync` relies on a running event loop.** Inside a
   FastAPI request handler the loop is running, so `create_task`
   works. If `_process_paid` were ever called from a background
   thread (e.g. APScheduler), `loop.run_until_complete` would be
   used and could deadlock. Not currently triggered.
7. **`/api/auction-ws/events/{project_id}` is unauthenticated.**
   Anyone with a project_id can subscribe to chat, viewer count,
   and inventory events. Likely intentional (public live audience),
   but worth surfacing.
8. **Wallet adapter loaded for everyone.** `WalletProviders`
   wraps the entire app, importing
   `@solana/wallet-adapter-react-ui/styles.css` and Phantom /
   Solflare adapters even on `/discover` and `/merchant`. Bundle
   bloat, and a presence on consumer pages that conflicts with
   the spirit of §12 rule 3 ("Never show Solana/blockchain on
   consumer pages") — though no UI shows. Not confirmed whether
   the adapters' `<WalletModalProvider>` ever pops on the buy path.
9. **Frontend `apiBase.ts` localhost fallback.** Already noted in
   `ROADMAP.md` Known Issues. Reproduces here for completeness:
   missing `NEXT_PUBLIC_API_URL` in a Vercel build silently ships
   a broken production frontend (the HTTPS auto-upgrade explicitly
   skips localhost).
10. **Test/dev Stripe verification bypass exists.** Hard-disabled
    against `sk_live_*`, but if a teammate later removes that
    guard, a checkout could proceed against an unverified Connect
    account in production. Not currently a vulnerability — the
    guard is in place — but the surface exists.

---

## 6. Recommended Next Tasks

Surgical, ordered. Each is its own task file. Each can ship
independently.

1. **`task: orders-success-page`** — Add a dedicated
   `/orders/success?session_id=...` route. Stripe `success_url`
   becomes this route. Page reads order status via a new
   `GET /api/checkout/orders/by-session/{session_id}` endpoint
   (auth: buyer's Privy), polls until `status="paid"` or
   timeout (~30s), then renders confirmation + DUM Points earned.
   Removes the project-page polling hack. **Doctrine: Phase 0/1
   only.** No Solana surface. *(Files: new route + new endpoint.
   Touches `frontend/app/project/[id]/page.tsx` only to remove
   the success-banner block lines 2962–3004 and replace with a
   redirect.)*
2. **`task: purge-dead-google-signin-button`** — Delete
   `frontend/components/GoogleSignInButton.tsx`. Confirm via
   grep no importers. Removes the only Supabase-Auth code path
   in the auth surface. *(One file deleted.)*
3. **`task: dum-reward-formula-shared-const`** — Move
   `min(50, 10 + floor(amount / 5))` to a single shared
   constant. Backend keeps it in `checkout.py`. Frontend imports
   from `frontend/lib/dumRewardFormula.ts` (new file). One
   source of truth; eliminates risk #2. *(Two files.)*
4. **`task: pending-order-sweeper`** — Cron-like background
   sweep that calls the existing
   `POST /api/checkout/orders/recover-pending` logic on orders
   older than N minutes still in `pending_payment`. FastAPI
   `lifespan` task or external scheduler. Risk #4. *(One new
   service file + main.py wiring.)*
5. **`task: lazy-load-wallet-providers`** — Move
   `WalletProviders` import to dynamic load behind a check for
   the routes that actually use Solana (`/hub`, `/vault`,
   `/technology`). Removes adapter cost from `/discover`,
   `/merchant`, `/business`, `/project/[id]`. Risk #8. *(One
   file: `AppProviders.tsx`.)*
6. **`task: hard-fail-missing-api-base`** — In
   `frontend/lib/apiBase.ts`, throw when `NEXT_PUBLIC_API_URL`
   is unset and `NODE_ENV === "production"`. Risk #9. *(One
   file.)*
7. **`task: ws-events-rate-limit-floor`** — Add an IP-based
   rate limit on the WebSocket endpoint connection rate
   (currently only chat is rate-limited per-user). Risk #7.
   *(One file: `backend/api/routes/auction_ws.py`.)*

Items 1, 2, 3, 6 are the smallest and most defensible; do them
first.

---

## 7. Phase Plan

### Phase 0/1 — Stripe-only live purchase flow (now)
- Land Recommended Tasks 1–6 above. None of these introduce a
  Solana surface, none break the doctrine.
- Goal stays as Phase 0B in `ROADMAP.md`: 1 real paid Stripe
  transaction against Topgun Maintenance.
- Definition of done: a buyer (Julian's outreach target) can hit
  Buy on `/project/topgun-maintenance`, complete Stripe Checkout,
  land on `/orders/success`, and see the order in `paid` state
  within ≤30s. A row in `orders` with `status='paid'` and
  amount > 0 against production-mode Stripe satisfies §6 Phase 0B
  unlock.

### Phase 2 — Post-checkout DUM Points visibility (later)
- Unlock condition (per CLAUDE.md §6): 10+ verified sellers AND
  $1,000+ real GMV AND legal review of the points purchase flow.
- Enable DUM Points in Navbar + reveal `/hub` from nav.
- The plumbing already exists:
  - `users.dum_balance` is awarded by `_process_paid`
    (checkout.py:751).
  - `dum_transactions` ledger exists.
  - Cross-merchant redemption is the
    `use_dum_discount` branch in checkout — already wired.
- No new payment infrastructure required. Surfacing only.

### Phase 3 — Optional Solana / SOL checkout (gated, never default)
- Unlock condition: Phase 2 proven (data showing repeat purchases
  driven by Points) AND legal sign-off on the Solana claim flow.
- Recommended scoping when unlocked, **not now**:
  - Buyer toggle on the buy button: "pay in SOL" — opt-in only,
    never default, hidden from anonymous users.
  - Backend new route `POST /api/checkout/sol-intent` mirroring
    the Stripe path: produces a signed reference, the frontend
    constructs and submits the SPL/SOL transfer with Phantom
    via the existing `WalletProviders` stack, the backend
    confirms on-chain via `getTransaction` and writes the same
    `orders` row with `payment_method="sol"`, `tx_signature=...`.
  - Idempotency keyed on `tx_signature`.
  - Settlement to merchant in SOL is out of scope; treat
    initial Phase 3 as platform-custodied SOL → off-chain
    payout to merchant in USD via a separate process. (This is
    a planning note only — no implementation now.)

---

## 8. Files Reviewed

Frontend
- `frontend/package.json`
- `frontend/components/AppProviders.tsx`
- `frontend/components/WalletProviders.tsx`
- `frontend/lib/auth/AuthContext.tsx`
- `frontend/components/GoogleSignInButton.tsx`
- `frontend/components/LiveChatIVS.tsx` (lines 1–90)
- `frontend/app/orders/page.tsx`
- `frontend/app/project/[id]/page.tsx` (targeted reads:
  imports, lines 1240–1320 buy flow, 2960–3010 post-checkout,
  4088 / 5649 pin handlers, plus grep over the full file for
  `pinned_offer`, `WebSocket`, `/api/checkout/`, `Phantom`)
- Greps over `frontend/app`, `frontend/lib`, `frontend/components`
  for: `Privy`, `Phantom`, `useSolanaWallets`, `SystemProgram`,
  `solana_pay`, `payInSol`, `IVS`, `live`, `WebSocket`,
  `viewer_count`, `item_updated`, `checkout=success`

Backend
- `backend/main.py` (CORS, route mounts, lifespan)
- `backend/api/routes/checkout.py` (full)
- `backend/api/routes/auction_ws.py` (full)
- `backend/api/routes/ivs.py` (full)
- `backend/api/routes/merchant.py` (lines 488–730 area:
  `stripe_connect_status` + OAuth callback writes)
- `backend/services/solana_mint.py` (full)
- `backend/db/migrations/` directory listing (014–033)
- Greps over `backend/` for `Phantom`, `@solana/web3`,
  `stripe_connect_id`, `pinned_offer`, `is_solana_enabled`

Project / docs (read in prior session for context)
- `CLAUDE.md`, `README.md`, `ROADMAP.md`, `production.md`,
  `sanity-check.md`, `.env.example`, `docker-compose.yml`,
  `.claude/tasks/` listing, `frontend/Dockerfile`,
  `backend/Dockerfile`

**Not opened (referenced but not read in this audit):**
- `backend/api/routes/dum_points.py`
- `backend/api/routes/auctions.py`
- `frontend/components/IVSStageHost.tsx`,
  `IVSStageViewer.tsx`
- `frontend/app/hub/page.tsx`, `vault/page.tsx`,
  `technology/page.tsx`
- `backend/db/migrations/031_topgun_storefront_seed.sql`
- Full `orders` table DDL — column inventory inferred from
  query/insert calls only

---

## 9. Commands Run

Read-only inspection. No mutations.

```
ls -la /home/user/Dum-Club/
ls /home/user/Dum-Club/.claude/tasks/
ls /home/user/Dum-Club/frontend/
ls /home/user/Dum-Club/frontend/app/
ls /home/user/Dum-Club/frontend/lib/
ls /home/user/Dum-Club/frontend/components/
ls /home/user/Dum-Club/frontend/components/discover/
ls /home/user/Dum-Club/frontend/lib/auth/
ls /home/user/Dum-Club/frontend/lib/supabase/
ls /home/user/Dum-Club/frontend/__tests__/
ls /home/user/Dum-Club/frontend/app/orders/
ls /home/user/Dum-Club/backend/
ls /home/user/Dum-Club/backend/api/
ls /home/user/Dum-Club/backend/api/routes/
ls /home/user/Dum-Club/backend/services/
ls /home/user/Dum-Club/backend/db/
ls /home/user/Dum-Club/backend/db/migrations/
ls /home/user/Dum-Club/backend/tests/
ls /home/user/Dum-Club/scripts/

cat /home/user/Dum-Club/README.md
cat /home/user/Dum-Club/package.json
cat /home/user/Dum-Club/frontend/package.json
cat /home/user/Dum-Club/frontend/Dockerfile
cat /home/user/Dum-Club/backend/Dockerfile
cat /home/user/Dum-Club/backend/main.py        # head
cat /home/user/Dum-Club/backend/requirements.txt # head
cat /home/user/Dum-Club/.env.example           # head
cat /home/user/Dum-Club/production.md
cat /home/user/Dum-Club/sanity-check.md
cat /home/user/Dum-Club/handoff-template.md
cat /home/user/Dum-Club/ROADMAP.md             # head

grep -rn "Privy|privy"      frontend/components frontend/lib frontend/app/layout.tsx
grep -rln "Phantom|phantom|wallet-adapter|WalletProvider" frontend/
grep -rln "AuthButton|signInWithGoogle|GoogleSignInButton|loginButton" frontend/
grep -rln "pinned_offer|pinnedOffer|pinned_offer_id"  frontend/ backend/
grep -rln "Phantom|@solana/web3"  backend/
grep -rln "create_payment_intent|/api/checkout/"  frontend/
grep -rln "useSolanaWallets|solana.*pay|SystemProgram\.transfer" frontend/app/
grep -rln "Phantom|solanaPay|payInSol" frontend/app/
grep -rn  "checkout=success|checkout.success|searchParams.*checkout" frontend/
grep -n   "pinned_offer|/api/checkout/"  frontend/app/project/[id]/page.tsx
grep -n   "WebSocket|new WebSocket|wss://|ws://" frontend/app/project/[id]/page.tsx
grep -n   "auction_ws|/api/live/events|broadcastLiveEvent" frontend/app/project/[id]/page.tsx
grep -rn  "viewer_count|item_updated|item_sold" frontend/
grep -rn  "ENABLE_IVS_REALTIME|is_ivs_enabled" backend/services/ivs_realtime.py
grep -rn  "stripe_connect_id|stripe_connect_status|charges_enabled" backend/api/routes/merchant.py

# Targeted reads of files listed in §8.
```

---

## 10. Final Recommendation

The Stripe-Connect-direct live purchase pipeline is correctly
shaped, doctrine-compliant, and end-to-end wired. The single
material UX gap is the missing dedicated success page — the
"did my payment go through" moment depends on a 10-second
polling window on the project page. That is the highest-leverage
fix and it has no Solana surface, no doctrine conflict, and
touches three files.

**Next single task Claude should perform after this audit:**

> `run task: orders-success-page`
>
> Add a dedicated `/orders/success?session_id=…` route that the
> Stripe `success_url` redirects to. Page polls a new
> `GET /api/checkout/orders/by-session/{session_id}` endpoint
> until `status='paid'` or 30s timeout. On success: show
> confirmation, the offer title, the amount paid, and the DUM
> Points earned (computed from the shared formula in
> Recommended Task #3 if landed, else inline the same formula
> with a comment pointing to the backend). Remove the
> 2s/5s/10s polling block in `frontend/app/project/[id]/page.tsx`
> lines 2962–3004 and replace with a redirect to the new page.
>
> Files expected to change:
> - `frontend/app/orders/success/page.tsx` (new)
> - `backend/api/routes/checkout.py` (new
>   `GET /orders/by-session/{session_id}` endpoint)
> - `frontend/app/project/[id]/page.tsx` (remove inline
>   success-banner block; update default `success_url` if
>   needed — but the buy flow already passes `cleanUrl`, so the
>   change is small)
>
> Doctrine: Phase 0/1, Stripe-only, no Solana surface added.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
