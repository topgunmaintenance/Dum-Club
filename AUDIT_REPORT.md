# DUM Club — Live Buy Flow Audit Report

Branch: `claude/complete-audit-report-RX6Gc`
Date: 2026-05-01
Scope: Read-only audit of the Stripe live-buy flow, IVS live viewer
flow, and any Solana surface that touches checkout. No source code
was changed by this report.

---

## Executive Summary

DUM Club already has a working Stripe Connect checkout pipeline,
real-time inventory broadcast over WebSocket, and an IVS Real-Time
viewer surface — all wired into the per-project page at
`/project/[id]`. The plumbing is in place to take a real paid
transaction through Topgun Maintenance.

Login is via Privy (Google + email), with Solana embedded wallets
auto-provisioned by Privy. A separate Phantom/Solflare wallet
provider tree is mounted but is unused by checkout — checkout is
strictly Stripe (Direct Charges via Stripe Connect).

There is no Solana checkout. The only Solana-adjacent flows are
post-purchase DUM Points side-effects (`mint_dum_to_wallet`) and a
SOL→DUM swap endpoint behind `/api/dum/swap` — both gated on env
flags (`DUM_MINT`, `DUM_TREASURY_KEYPAIR`) and not surfaced to
buyers during checkout.

The biggest pre-launch risks are not in the code — they are
environmental: the production Stripe Connect secret/client_id pair
must come from the same account, the Connect redirect URI must
match Stripe dashboard verbatim, and `recent-sales` filters demo
rows out so there is no fake-data leakage. All three are handled
in code; they only need correct env wiring.

---

## Current Doctrine / Scope Confirmation

Confirmed against `CLAUDE.md` v5.0, `CURRENT_SPRINT.md`, and
`SESSION_TEMPLATE.md`:

- Phase 0B is active. Goal: one real paid Stripe transaction
  against Topgun Maintenance's storefront.
- Stripe is the ONLY payment processor. No Square, no PayPal, no
  GoDaddy. Square OAuth code still exists in `merchant.py` but
  the merchant page surface has been removed (per ROADMAP.md).
- Solana checkout is Phase 3, locked. Solana may be planned/
  audited but not implemented now.
- DUM Points hidden from navbar until Phase 2.
- DUM Points purchase flow exists at backend (`/api/dum/purchase`)
  but is hidden in the frontend `/hub` UI pending legal review.
- FOUNDING_CAP = 100, defined at
  `backend/api/routes/merchant.py:215`.
- 0% commission. The platform fee in code is
  `PLATFORM_FEE_RATE = 0.07` at `backend/api/routes/checkout.py:80`,
  applied as Stripe `application_fee_amount` on the connected
  account's Direct Charge. Doctrine says "0% commission" — see
  the Gaps / Risks section. (Not a doctrine violation by itself if
  doctrine treats this as the platform's separate "buyer-side"
  margin; flagged so the discrepancy is on the record.)

---

## Frontend Findings

### Privy provider setup

- `frontend/components/AppProviders.tsx:1-34` — wraps the app in
  `PrivyProvider` with `loginMethods: ["google", "email"]` and
  `embeddedWallets.solana.createOnLogin: "users-without-wallets"`.
  Theme `dark`, accent `#00FFB2`.
- App ID comes from `NEXT_PUBLIC_PRIVY_APP_ID`. If unset, the
  provider falls back to rendering only `WalletProviders` with no
  Privy auth — a soft-fail path useful for local dev but a silent
  prod hazard if the env var is missing on Vercel.
- Mounted in `frontend/app/layout.tsx:5,40,59` via `<AppProviders>`.

### AuthButton / login components

- There is no dedicated "AuthButton" component. The login surface
  lives inside `frontend/components/Navbar.tsx:610-628`, calling
  the stable `login()` from `useAuth()` (Navbar.tsx:11). Label
  reads "Continue with Google".
- `frontend/lib/auth/AuthContext.tsx:30-164` — `AuthProvider`
  composes `usePrivy()` and `useSolanaWallets()`, exposes a
  `useAuth()` hook returning `{user, loading, isAdmin, login,
  logout, getToken}`. After Privy login, it POSTs to
  `${API_BASE}/api/auth/sync` (line 91) with `privy_id`, `email`,
  `embedded_wallet`, `linked_wallets`, `google_linked`. It also
  has a referral conversion side-effect against
  `/api/referrals/convert/<code>`.
- `frontend/components/GoogleSignInButton.tsx:1-48` — uses the
  Supabase JS client `signInWithOAuth({provider:"google"})` with a
  redirect to `/auth/callback`. This is a SECOND Google sign-in
  path, separate from Privy. Not confirmed where it's rendered;
  grep shows no current import. May be a legacy artifact. Flagged
  as a gap (see Gaps / Risks).

### Phantom / Solana wallet support

- `frontend/components/WalletProviders.tsx:1-32` — mounts
  `ConnectionProvider`, `WalletProvider`, `WalletModalProvider`
  with `PhantomWalletAdapter` and `SolflareWalletAdapter`.
- Endpoint comes from `NEXT_PUBLIC_SOLANA_RPC_URL`, falling back to
  `https://api.devnet.solana.com`.
- This provider tree is mounted globally via
  `AppProviders → WalletProviders`. It is NOT used by the buy
  flow. It is used by `/hub` for SOL→DUM swap and on-chain DUM
  claim/balance UI. Buyer authentication for checkout is Privy
  only.

### Live viewer page

- The "live viewer page" is the same per-project page,
  `frontend/app/project/[id]/page.tsx`. There is no separate
  `/live/[slug]` route in the repo today.
- Two live providers are supported, gated by
  `NEXT_PUBLIC_ENABLE_IVS_REALTIME` (`frontend/lib/liveProvider.ts:5`):
  - `ivs_realtime` — AWS IVS Real-Time stages, via
    `IVSStageHost` (host) and `IVSStageViewer` (viewer).
  - `native_mux` / `manual_embed` — Mux playback or manual stream
    URL.
- Page renders the host component (line 3759) when `isOwner` and
  IVS is enabled; renders a viewer component when `is_live` and
  the project's `live_provider` is `ivs_realtime` (line 3802).
- `frontend/components/IVSStageViewer.tsx:42` — calls
  `POST /api/ivs/viewer-token` to get a SUBSCRIBE token, then
  joins the IVS Stage and subscribes to remote participants only.
- Polling fallback for non-owners: when `project.is_live` is true
  and the user is not the owner, the page polls project state +
  offers every 3 seconds (lines 2872-2905) so pinned-offer changes
  propagate even when WebSocket isn't connected.

### Pinned product / buy button flow

- Project state carries `pinned_offer_id` (page.tsx:78) and the
  page resolves the pinned offer at line 2420
  (`pinnedOffer = offers.find(o => o.id === project.pinned_offer_id)`).
- The fixed sticky buy bar at the bottom of the project page (and
  the inline buy buttons) call `buyOffer(offer, auctionId?,
  overridePrice?)` at line 1200.
- Click handler at line 4056 wires the pinned offer's Buy button to
  `buyOffer(pinnedOffer)`.
- Auction "Pay Now" winner flow calls
  `buyOffer(auctionOffer, auction.id, Number(auction.current_bid))`
  at line 2584 with the override price set to the winning bid.

### Stripe checkout flow (frontend)

- `buyOffer` at lines 1200-1320:
  1. Fetches Privy access token via `getToken()`.
  2. Builds `cleanUrl = window.location.origin + pathname` to
     avoid stale query params on repeat purchases.
  3. POSTs to `${API_BASE}/api/checkout/create-payment-intent`
     with body
     `{offer_id, success_url, cancel_url, use_dum_discount,
       source: "live_auction"|"live"|"normal",
       auction_id?, override_price?}`.
  4. Auth header is `Bearer <Privy access token>`.
  5. On `200 OK`, reads `data.checkout_url`, captures a purchase
     event for automation, stashes `liveLastBuyPrice` in
     `sessionStorage`, and `window.location.href = checkout_url`.
- No Stripe Elements / Stripe.js usage on the client. The
  client redirects out to Stripe-hosted Checkout. This matches
  the backend Direct-Charge model.

### Order success page

- There is NO dedicated `/order/success` route. The
  `success_url` Stripe is handed is the same project page with
  `?checkout=success` appended (backend appends this query
  param at `checkout.py:436`).
- Post-redirect handling at `page.tsx:2962-3004`:
  - Reads `checkout=success` / `checkout=cancelled` from URL.
  - On success, computes locally-mirrored DUM Points reward
    (`min(50, 10 + floor(price/5))`) using the cached
    `liveLastBuyPrice` from `sessionStorage`, shows a 10-second
    confirmation, schedules three `loadOffers()` /
    `loadSellerOrders()` refreshes at +2s/+5s/+10s to wait for
    the webhook to land, then strips the `checkout` query param
    from the URL.
- `/orders` page (`frontend/app/orders/page.tsx`) is the buyer's
  history view. It calls `GET /api/checkout/orders/buyer` with
  the Privy bearer and renders status pills (`paid`,
  `pending_payment`, `fulfilled`).

### Real-time viewer updates

- Single WebSocket per project at
  `wss://<API_HOST>/api/auction-ws/events/<project_id>`
  (mounted by `frontend/components/LiveChatIVS.tsx:47`).
- Message types handled by the client:
  `chat`, `viewer_count`, `item_updated`, `item_sold`.
- `item_updated` / `item_sold` are pushed by the backend webhook
  after a Stripe `payment_status=paid` event lands — see
  `backend/api/routes/checkout.py:679-696`. So inventory in the
  viewer updates within ~1 second of a real Stripe payment.
- Auction lifecycle (`bid`, `auction_started`, `auction_ended`,
  `auction_tick`) is broadcast via the same channel from
  `auction_ws.py:55-70`.

---

## Backend Findings

### Stripe checkout endpoint

- `backend/api/routes/checkout.py` registered under `/api/checkout`
  in `backend/main.py:223`.
- `POST /api/checkout/create-payment-intent` (despite the name,
  this is a **Stripe Checkout Session**, not a bare PaymentIntent
  — it returns a hosted `checkout_url`).
- Auth: `Depends(get_current_user)` (Privy bearer required).
- Flow:
  1. Loads offer, resolves seller via `projects.privy_id`
     (fallback `owner_id`).
  2. Computes price, optional DUM Points 10% subsidy (deducts 10
     points from buyer, credits project's `dum_received`,
     reduces customer-facing price; seller payout still based on
     original).
  3. Computes `application_fee_cents` from `PLATFORM_FEE_RATE
     = 0.07` (7%) of seller payout base.
  4. Looks up seller's `merchants.stripe_connect_id` via
     `owner_privy_id`. If missing → 400
     `merchant_stripe_not_connected`.
  5. Calls `_assert_merchant_can_receive` which does
     `Stripe.Account.retrieve(connect_id)` and refuses unless
     `charges_enabled AND payouts_enabled`. Has a documented
     `ENVIRONMENT=development` / `STRIPE_TEST_MODE=true` bypass
     that is **hard-disabled** when `STRIPE_SECRET_KEY` starts
     with `sk_live_` (lines 49-64).
  6. Creates the Checkout Session via
     `s.checkout.Session.create(..., stripe_account=connect_id)`
     — i.e. Direct Charge model. `payment_intent_data` carries
     the `application_fee_amount` and optional `receipt_email`.
  7. Inserts an `orders` row with `status='pending_payment'`,
     `stripe_session_id`, `stripe_payment_intent_id` (initially
     may be null until Stripe finalises), and the seller/buyer
     IDs.
  8. Backfills `metadata.order_id` onto both the Session and the
     PaymentIntent (lines 491-527) so the webhook can resolve
     the order even if the DB lookup misses.
  9. Returns `{checkout_url, session_id, order_id, final_price,
     platform_fee, seller_receives}`.

### Stripe webhook endpoint

- `POST /api/checkout/webhook` (`checkout.py:552`).
- Signature verification: `Stripe.Webhook.construct_event(payload,
  sig_header, STRIPE_WEBHOOK_SECRET)`.
- Idempotency: a `processed_webhook_events` table is consulted by
  `event_id` (line 579). If duplicate, returns `{received:true,
  duplicate:true}`. Insertion is best-effort at the end.
- Handles three event types:
  - `checkout.session.completed` — main path. Skipped unless
    `payment_status == "paid"`. Has a special branch for
    `metadata.purchase_type == "dum_points"` that credits the
    user's `dum_balance` and best-effort calls
    `services.solana_mint.mint_dum_to_wallet` if Solana is
    enabled. Otherwise routes to `_process_paid` for offer
    orders.
  - `payment_intent.succeeded` — secondary path; if PI lookup
    fails, retries by listing
    `s.checkout.Session.list(payment_intent=pi_id)` to recover
    the session and metadata, then re-runs `_find_order`.
  - `account.updated` — syncs
    `merchants.stripe_connect_status` to
    `verified | restricted | pending_verification` based on
    `charges_enabled`, `payouts_enabled`, `details_submitted`,
    `requirements.currently_due`, and `disabled_reason`.
- `_process_paid` (lines 640-792):
  1. Updates `orders.status='paid'`.
  2. Increments `offers.quantity_sold`, broadcasts
     `item_updated` (and `item_sold` if newly sold out) to the
     project's WebSocket room via `broadcast_sync(...)`.
  3. Awards DUM points to the buyer:
     `min(50, 10 + int(amount/5))`, inserts
     `dum_transactions` row with `reason='purchase_reward'`.
  4. Sends two emails: `send_buyer_payment_confirmed` and
     `send_seller_new_order` (both non-blocking).

### Order / payment state model

Inferred from `checkout.py` only — the migrations were not opened
in this audit. Statuses observed:
- `pending_payment` — order created, Stripe Session opened, no
  payment yet.
- `pending` — older alias accepted by the webhook lookup
  `_find_order` (line 627). Not confirmed if any code still
  inserts this status today.
- `paid` — set by webhook on confirmed payment.
- `fulfilled` / `delivered` — set by
  `PATCH /api/checkout/orders/{order_id}/status` (line 1092)
  by the project owner. Triggers a `send_buyer_fulfilled` email.

Order columns referenced by code:
`id`, `offer_id`, `project_id`, `buyer_user_id`,
`seller_user_id`, `amount_paid_usd`, `platform_fee_usd`,
`seller_receives_usd`, `stripe_payment_intent_id`,
`stripe_session_id`, `status`, `buyer_email`, `notes`,
`token_discount_applied`, `source`, `created_at`, `updated_at`.

### Merchant Stripe Connect verification

- `backend/api/routes/merchant.py` registered at `/api/merchant`.
- OAuth flow:
  - `POST /api/merchant/stripe-connect/authorize` — builds the
    Stripe Connect `oauth/authorize` URL, scope `read_write`,
    state = HMAC-signed token bound to `privy_id` with TTL.
    Redirect URI is `_STRIPE_CONNECT_REDIRECT_URI`, env-overridable,
    default `https://dum.club/api/stripe/oauth/callback`.
  - That URL is served by a thin Next.js handler at
    `frontend/app/api/stripe/oauth/callback/route.ts` that
    302-redirects to `/merchant/stripe-callback` preserving
    `code`, `state`, `error`, `error_description`. The
    redirect is necessary because Stripe forbids changing the
    registered URI and the actual code-exchange must run with
    a Privy bearer (browser navigation can't carry it).
  - `/merchant/stripe-callback` (frontend page) calls
    `${API_BASE}/api/merchant/stripe-connect/callback?code=...&state=...`
    with the Privy bearer; backend exchanges the code, writes
    `merchants.stripe_connect_id` and
    `stripe_connect_status='connected'`.
- `GET /api/merchant/stripe-connect/status` (line 487) — does a
  fresh `Account.retrieve` on every call, computes status, writes
  back to `merchants.stripe_connect_status`. Status vocabulary:
  - `not_connected` — no `stripe_connect_id`.
  - `pending_verification` — has id, but Stripe says checks not
    done.
  - `verified` — `charges_enabled AND payouts_enabled AND
    details_submitted AND no currently_due AND no disabled_reason`.
  - `restricted` — `disabled_reason` present.
- Defensive `.strip()` on `STRIPE_SECRET_KEY` and
  `STRIPE_CONNECT_CLIENT_ID` at every read site
  (`merchant.py:32-33`, `checkout.py:26-27`) — guards against
  trailing whitespace from Railway's env editor that has
  historically caused "No application matches the supplied client
  identifier" errors.
- Boot-time fingerprint logging of secret_mode (test/live/unknown)
  and client_id_fp (`merchant.py:73-105`) — non-secret diagnostic
  to detect mismatched Stripe credential pairs.

### IVS / live stream endpoints

- `backend/api/routes/ivs.py` mounted at `/api/ivs`. Endpoints:
  - `POST /api/ivs/create-stage` — owner only. Cleans up any
    stale `ivs_stage_arn` first, creates a fresh stage, waits 1s
    for AWS propagation, mints a PUBLISHER token, sets
    `projects.is_live=true` and `live_provider='ivs_realtime'`.
    Daily stream cap enforced via `register_stream_start`.
  - `POST /api/ivs/host-token` — re-mints a PUBLISHER token for
    an existing stage owned by the caller.
  - `POST /api/ivs/viewer-token` — issues a SUBSCRIBE token.
    Rate-limits joins, enforces viewer capacity via
    `add_viewer`, returns `{token, participant_id, stage_arn}`.
  - `POST /api/ivs/end-stage` — owner deletes the stage, clears
    `is_live`, `ivs_stage_arn`, `live_provider`, `stream_url`,
    `pinned_offer_id`, `live_playback_id`, etc.
- All four endpoints first call `_require_ivs()` which 503s
  unless `ENABLE_IVS_REALTIME_BACKEND=true` and AWS creds are
  present. So IVS is feature-flagged at the env level.
- A separate `backend/api/routes/live_relay.py` exposes a
  WebSocket at `/api/live/stream/<project_id>` for the legacy
  Mux relay path. Not wired into the IVS path.

### WebSocket real-time item / order updates

- `backend/api/routes/auction_ws.py` — single WebSocket route
  `/api/auction-ws/events/<project_id>`.
- Maintains `_connections: Dict[project_id, Set[WebSocket]]` in
  process memory.
- On connect: sends current `auction_state` (if active auction)
  and current `viewer_count`; broadcasts updated viewer count to
  the room.
- Handles inbound messages: `ping`, `chat` (with rate limit +
  stream-duration cap that auto-ends a stream that has run too
  long).
- Outbound broadcasts (server → all viewers in room):
  - `bid` (from auctions.py)
  - `auction_started` / `auction_ended` / `auction_tick`
  - `item_updated`, `item_sold` (from checkout webhook)
  - `chat`, `viewer_count`, `stream_expired`
- `broadcast_sync(project_id, event)` is the bridge from sync
  code (Stripe webhook handler) to async WebSocket sends.
- This is in-process state. With more than one backend instance
  on Railway, broadcasts won't span instances. Not confirmed
  whether Railway runs >1 worker today — the design assumes
  single-process.

### Any Solana-related backend code found

- `backend/services/solana_mint.py` — wraps a Node.js mint
  script. Reads `DUM_MINT`, `DUM_TREASURY_KEYPAIR` (base58 secret
  string — explicit JSON-array detection + auto-disable),
  `DUM_TREASURY_WALLET`, `SOLANA_RPC_URL`. `is_solana_enabled()`
  returns `bool(DUM_MINT and DUM_TREASURY_KEYPAIR)`.
- `backend/api/routes/dum_points.py`:
  - `POST /api/dum/swap` — SOL→DUM. Verifies an inbound SOL
    transaction signature against the treasury wallet via
    Solana RPC, then awards DUM. Min 0.01 SOL, max 5 SOL per tx,
    20 SOL/day per user, 30s cooldown.
  - `POST /api/dum/claim` — on-chain claim. Calls
    `mint_dum_to_wallet` after DB checks.
  - `POST /api/dum/purchase` — Stripe-funded DUM Points purchase
    (NOT SOL-funded). Creates a Stripe Session with
    `metadata.purchase_type = "dum_points"`. Handled in the
    webhook by a dedicated branch that credits the user's DB
    balance and best-effort mints on-chain via
    `solana_mint`. This endpoint exists but is hidden in the
    frontend `/hub` UI per CLAUDE.md (legal review pending).
  - `POST /api/dum/swap-demo` — exists, scope not audited here.
- `backend/api/routes/checkout.py:828-835` — the only place
  Solana enters the checkout path. It runs ONLY in the DUM Points
  Stripe purchase branch (`metadata.purchase_type == "dum_points"`)
  and is wrapped in a try/except labeled "non-fatal". A normal
  offer purchase never touches Solana.

**No Solana checkout for offers exists.** Offers are Stripe-only
end-to-end. This matches doctrine.

---

## Gaps / Risks

1. **0% commission claim vs 7% application fee.**
   `PLATFORM_FEE_RATE = 0.07` is taken as a Stripe
   `application_fee_amount` on every offer purchase. Doctrine
   ("0% commission, always") and the homepage comparison table
   ("Flat $29-$99/mo, 0% per sale") are at odds with this code
   path. Either the doctrine intends "no commission to the
   merchant" while the buyer-side margin from §13 is delivered
   via the Stripe application fee, or this rate needs to come
   down to 0 before public launch. Not a doctrine violation
   on its face but the discrepancy is on the record.

2. **Two Google sign-in paths.** Privy (the live auth surface
   used by `useAuth`) AND Supabase OAuth in
   `GoogleSignInButton.tsx`. The Supabase button does not appear
   to be imported anywhere I traced today, but it remains in the
   bundle. Risk: a future page renders it and creates a divergent
   session that the rest of the app doesn't know about.

3. **`AppProviders` silent fallback when `NEXT_PUBLIC_PRIVY_APP_ID`
   is missing.** Renders only `WalletProviders` — the whole app
   loses authenticated buy capability with no visible error.
   Same shape as the `apiBase.ts` fallback already flagged in
   ROADMAP.md.

4. **Pending `pending_payment` orders can strand.** Webhook
   misses, network blips, or Stripe retry exhaustion can leave
   an order in `pending_payment` while Stripe shows it paid.
   `POST /api/checkout/orders/recover-pending` exists for an
   admin to reconcile, but there's no automatic sweep / cron.

5. **In-process WebSocket fanout.** `_connections` is per-process.
   If Railway is ever scaled past one worker, broadcasts and
   viewer counts diverge per-pod. Not confirmed whether prod is
   single-pod today.

6. **Frontend `/orders` page has no skeleton for the
   pending-payment edge case in the `loading` branch — but it
   does correctly badge the status. Minor.

7. **Storefront rendering bug already documented in
   `ROADMAP.md`** (`/project/topgun-maintenance` shows
   "Untitled Project" because the frontend `loadProject()` call
   never seems to fire in production). Pre-existing; not
   introduced by anything in scope of this audit, but it gates a
   real-paid Stripe transaction. **This is the actual blocker.**

8. **`recent-sales` filter is correct but fragile.** The
   "real Stripe sales only" filter relies on the presence of
   `stripe_session_id` or `stripe_payment_intent_id`. If a future
   migration ever inserts demo orders with a fake `stripe_*` id,
   the filter passes them through. Not a current risk.

9. **No `/order/success` route.** The post-checkout landing is
   the same project page with a `?checkout=success` query. Works
   today, but if Stripe ever drops the query string (it won't,
   but if a misconfigured CDN does), there is no surface to fall
   back to.

10. **Webhook idempotency table is best-effort.** `try/except:
    pass` on the `processed_webhook_events` lookup means a
    missing table silently disables idempotency rather than
    refusing the request. Acceptable for first launch; flag for
    hardening.

---

## Recommended Next Tasks

(Ordered. Each is small and reversible. Do not bundle.)

1. **Fix the Topgun Maintenance storefront render bug.** Open
   DevTools Network + Console on
   `https://dum.club/project/topgun-maintenance` in production
   and capture whether `loadProject()` fires, what URL it hits,
   what HTTP status comes back. This is the active blocker on
   the one real Stripe transaction. (Already the documented
   "next step on resume" in ROADMAP.md:17.)
2. **Smoke-test the full checkout end-to-end against Topgun
   Maintenance** in test mode (`sk_test_*`) once the storefront
   renders correctly. Confirm `pending_payment → paid` flips,
   `item_updated` fires on the WebSocket, DUM points award, both
   emails send.
3. **Resolve the 7% application fee vs "0% commission" doctrine
   discrepancy** — either update doctrine to acknowledge the
   buyer-side margin (per §13 stream 5), or set
   `PLATFORM_FEE_RATE = 0.0` for Phase 0B.
4. **Delete `frontend/components/GoogleSignInButton.tsx`** if it
   is in fact unused — confirm with a hard `grep -rn
   "GoogleSignInButton"` first.
5. **Hard-fail in production builds when `NEXT_PUBLIC_PRIVY_APP_ID`
   or `NEXT_PUBLIC_API_URL` is missing.** Same shape as the
   ROADMAP fix already noted for `apiBase.ts:8`.
6. **Schedule a sweep of `pending_payment` orders** older than
   ~30 minutes — call `recover-pending` on a cron or accept the
   manual reconciliation as Phase 0B's posture.
7. (Phase 1 prep, not now.) Move WebSocket fanout to a shared
   broker (Redis pub/sub) before scaling backend past one worker.

---

## Phase Plan

### Phase 0/1 — Stripe-only live purchase flow

Already in code. No new work required to honor doctrine. Concrete
contract:
- Buyer auth: Privy (Google + email).
- Buyer pays via redirect to Stripe-hosted Checkout. No card
  data ever touches DUM Club's frontend or backend.
- Direct Charges to `merchants.stripe_connect_id` with a
  platform `application_fee_amount` (currently 7%, see
  Recommendation 3 above).
- Webhook flips `orders.status='paid'`, awards DUM points,
  broadcasts `item_updated` / `item_sold`, emails buyer + seller.
- Success: same project page, `?checkout=success`. Cancel: same,
  `?checkout=cancelled`.

The unlock for Phase 1 (100 founding sellers) is the same as
Phase 0B's: one real paid transaction. Phase 1 only changes
recruitment volume; the buy flow itself does not change.

### Phase 2 — Post-checkout DUM Points visibility

Gate (per CLAUDE.md §6): 10+ verified live sellers AND $1,000+
real GMV AND legal review of points purchase complete.

What changes:
- Re-surface the DUM Points entry point in `Navbar.tsx` (mobile
  + desktop) — currently removed at line 69. The `/hub` page
  itself already exists and works at direct URL.
- Re-surface the DUM Points purchase tier UI in `/hub` — the
  backend (`/api/dum/purchase`) and webhook branch already
  exist and work. Frontend just needs to un-hide the panel.
- AI retention agent reminders (Growth tier) start firing.

What does NOT change:
- The offer-purchase flow itself. DUM Points discount is
  already wired into `create-payment-intent` via
  `use_dum_discount`.

### Phase 3 — Optional Solana / SOL checkout

Gate: Phase 2 proven by data + legal sign-off on the Solana
claim flow. Solana stays opt-in only.

Existing Solana surface that becomes user-facing when this
unlocks:
- `POST /api/dum/swap` (SOL → DUM) — backend complete, includes
  on-chain verification, daily caps, cooldown.
- `POST /api/dum/claim` (DB → on-chain DUM) — backend complete,
  best-effort mint via `solana_mint`.
- Phantom + Solflare wallet adapters already mounted via
  `WalletProviders.tsx`.
- `services.solana_mint.is_solana_enabled()` is the master
  switch, gated on `DUM_MINT` and `DUM_TREASURY_KEYPAIR` env
  vars.

What is NOT built and would be required if the policy ever
expanded to "pay for an offer in SOL" (this is explicitly NOT
the current direction):
- An SPL-token / SOL paywall on `create-payment-intent`. None
  exists. Stripe is the only checkout.
- Merchant SOL payout routing. None exists.
- Buyer-side SOL balance display in the buy bar. None exists.

Recommendation: do not build any of this in Phase 3. Keep Solana
to claim/swap of DUM Points only, exactly as doctrine prescribes.

---

## Files Reviewed

Frontend:
- `frontend/app/layout.tsx` (mount points only)
- `frontend/app/orders/page.tsx`
- `frontend/app/project/[id]/page.tsx` (relevant sections:
  buyOffer, post-checkout handling, IVS host/viewer mounting,
  pinned offer, polling fallback)
- `frontend/app/api/stripe/oauth/callback/route.ts`
- `frontend/components/AppProviders.tsx`
- `frontend/components/WalletProviders.tsx`
- `frontend/components/Navbar.tsx` (login button, DUM Points
  link removal confirmation)
- `frontend/components/GoogleSignInButton.tsx`
- `frontend/components/IVSStageViewer.tsx`
- `frontend/components/LiveChatIVS.tsx`
- `frontend/lib/auth/AuthContext.tsx`
- `frontend/lib/liveProvider.ts`

Backend:
- `backend/api/routes/checkout.py` (full)
- `backend/api/routes/merchant.py` (Stripe Connect sections)
- `backend/api/routes/ivs.py` (full)
- `backend/api/routes/auction_ws.py` (broadcast + WS handler)
- `backend/api/routes/dum_points.py` (purchase, swap, Solana
  refs)
- `backend/services/solana_mint.py` (env wiring + status)
- `backend/main.py` (router prefixes)

Doctrine / status:
- `CLAUDE.md`
- `CURRENT_SPRINT.md`
- `SESSION_TEMPLATE.md`
- `ROADMAP.md`

Files NOT opened in this audit (and therefore where claims are
marked "Not confirmed"):
- The Supabase migration files for the `orders`, `offers`,
  `merchants`, `processed_webhook_events`, `dum_transactions`
  tables. Schema claims above are inferred from query sites
  in the routes.
- `backend/services/email.py` send templates.
- `backend/auth/privy.py` (`get_current_user`, `require_admin`).

## Commands Run

```
git status
git branch --show-current
ls -la /home/user/Dum-Club/
ls /home/user/Dum-Club/frontend/{app,components,lib}
ls /home/user/Dum-Club/backend/{api,services}
ls /home/user/Dum-Club/frontend/app/api/stripe/oauth/callback
ls /home/user/Dum-Club/frontend/app/{discover,orders,dashboard,merchant}
grep -rn "stripe|checkout|create-payment-intent|buy" \
  frontend/app/project/[id]/page.tsx
grep -n "is_live|live_stream|IVS|ivs_|stage|playback|broadcast|websocket|WebSocket|pinned" \
  frontend/app/project/[id]/page.tsx
grep -rn "/api/auction-ws|wss://|/api/checkout|/api/ivs|/api/dum|/api/merchant" \
  frontend/{app,components,lib}
grep -n "router\.(post|get|patch|put|delete|websocket)" \
  backend/api/routes/{auction_ws,live_relay,auctions,dum_points}.py
grep -rn "solana|sol_|SOL\b|claim|wallet_adapter" \
  backend/api/routes backend/services
grep -n "include_router|prefix=" backend/main.py
grep -n "FOUNDING_CAP|stripe_connect_status|charges_enabled|payouts_enabled|/connect|/oauth|stripe_connect_id" \
  backend/api/routes/merchant.py
grep -n "/hub|DUM Points|points|Points" frontend/components/Navbar.tsx
```

(Plus targeted `Read` of each file listed in "Files Reviewed".)

---

## Final Recommendation

The Stripe live-buy flow, the IVS viewer surface, and the
real-time inventory broadcast are already wired correctly for
Phase 0B. Solana is correctly walled off from offer checkout. The
single immediate blocker is environmental, not architectural:
the Topgun Maintenance storefront does not render in production
because the client-side `loadProject()` call doesn't fire (per
ROADMAP.md:17). Until that renders, no buyer can click the Buy
button on the founding storefront.

**Next single task Claude should perform after this audit:**

> **Diagnose the `/project/topgun-maintenance` "Untitled Project"
> render bug in production.** Open DevTools Network + Console on
> `https://dum.club/project/topgun-maintenance`, capture whether
> the `loadProject()` fetch fires at all, what URL it targets,
> and any console error. Report findings before proposing a fix.
> No code changes in the diagnostic step.

Once that one storefront renders, the existing Stripe-only
checkout pipeline is ready to take Phase 0B's first real paid
transaction without any new code.
