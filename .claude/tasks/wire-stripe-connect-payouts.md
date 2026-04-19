# Task: wire-stripe-connect-payouts

## Summary

Unblock the first real paid Stripe transaction (Phase 0B gate) by
routing customer payments to the merchant's own Stripe Connect
account instead of the platform account. Add a live verification
gate so checkout refuses to create a session if the merchant's
Stripe account hasn't cleared identity review yet.

Backend-only. Express Connect via existing OAuth flow.

## Why

Audit (earlier in this session) found the checkout session builder
in `backend/api/routes/checkout.py:226-251` creates a
`stripe.checkout.Session` with NO `stripe_account`, NO
`application_fee_amount`, NO `transfer_data`. Funds land in the
platform's Stripe account. The `orders` table records
`platform_fee_usd` + `seller_receives_usd` as if the split were
happening — it isn't. No merchant on DUM Club can actually receive
money today, regardless of whether they've completed Connect
onboarding.

The OAuth flow at `merchant.py:263-309` also marks
`stripe_connect_status='connected'` the instant Stripe's callback
fires, before Stripe has verified identity (24-48h). So a merchant
can appear "ready" in the dashboard while actually being
`charges_enabled=false`.

## Doctrine constraints

- CLAUDE.md §8 — "Stripe Connect ONLY. Stripe is what Whatnot uses
  for payouts."
- CLAUDE.md §12 Rule 11 — "Stripe is the ONLY payment processor —
  no exceptions." This task lives in that lane. Do not introduce
  Destination charges or Separate-charges-and-transfers.
- CLAUDE.md §6 Phase 0B gate — "one paid Stripe transaction in
  production." This task is the mechanical unblock.
- CLAUDE.md §4 Stream 5 — the platform fee implementation here
  reuses the existing `PLATFORM_FEE_RATE = 0.07` constant in
  `checkout.py:41`, not the "1%" figure in doctrine. The
  discrepancy is flagged in the PR body for later reconciliation;
  this task does not change the rate.

## Scope

### Backend (3 edits in 2 files)

1. **`backend/api/routes/checkout.py` — session creation
   (lines ~225-251).**
   - Before the `Session.create`, look up the seller's merchant
     row: `merchants.select("stripe_connect_id, stripe_connect_status")
     .eq("owner_privy_id", seller_user_id)`.
   - If no row or `stripe_connect_id` is null → raise 400
     `merchant_stripe_not_connected` (merchant hasn't clicked
     Connect yet).
   - Call `stripe.Account.retrieve(stripe_connect_id)` — check
     `account.charges_enabled`.
   - If `charges_enabled` is false → raise 400
     `merchant_stripe_not_verified`. Include the current
     `requirements.currently_due` list in the detail so support
     can tell the merchant what Stripe wants.
   - Add to `session_params`:
     - `stripe_account=stripe_connect_id` (as a request-level
       kwarg on `Session.create`, not a payload key — direct
       charges pattern)
     - `payment_intent_data["application_fee_amount"] =
       int(round(platform_fee * 100))` where `platform_fee` is
       already computed at line 173

2. **`backend/api/routes/checkout.py` — webhook `account.updated`
   branch.**
   - Add `elif event["type"] == "account.updated":` before the
     `Unhandled event` else-branch around line 675.
   - Parse `event["data"]["object"]` as an Account payload.
   - Update `merchants` row matching `stripe_connect_id`:
     - `stripe_connect_status = "verified"` if
       `charges_enabled=True` AND `requirements.currently_due` is
       empty
     - `stripe_connect_status = "restricted"` if
       `requirements.disabled_reason` is set
     - `stripe_connect_status = "pending_verification"` otherwise

3. **`backend/api/routes/merchant.py` — new endpoint
   `GET /stripe-connect/status`.**
   - Auth via `get_current_user`.
   - Look up `merchants.stripe_connect_id` for the user.
   - If null → return `{"status": "not_connected"}`.
   - Else call `stripe.Account.retrieve(...)` and return:
     - `status` — same enum as the column update above
     - `charges_enabled`, `payouts_enabled` — booleans from Stripe
     - `requirements.currently_due` — list for UI display
     - `requirements.disabled_reason` — string or null
   - Side effect: write the computed status back to the cached
     `merchants.stripe_connect_status` column so the merchant
     dashboard shows fresh state even without the webhook.

### Doctrine doc

4. **`CLAUDE.md §8` — one line** documenting "Stripe Connect:
   Express (via OAuth)." Closes the account-type decision.

## Non-goals (refuse if asked in this PR)

- Destination-charges or Separate-charges-and-transfers flavors —
  Direct charges only.
- Standard Connect — OAuth flow stays Express.
- Platform-fee rate change from 0.07 to 0.01 — separate task.
- Refund / dispute / reversal flows.
- Multi-seller cart (one Stripe Session = one merchant).
- Frontend UX polish on `/merchant` page — if the status column
  lands correctly, existing UI shows the right string; polish is
  a follow-up. Checkout guard is the safety net.
- Any schema migration. No new columns needed;
  `stripe_connect_status` already exists (migration 026).

## Verification

Backend-only unit checks (Python, no live Stripe):

1. **Imports and compile clean** — `py_compile checkout.py merchant.py`.
2. **Session param shape** — unit test that mocks Stripe and
   confirms `Session.create` is called with:
   - `stripe_account=<merchant's connect id>` as a kwarg
   - `payment_intent_data["application_fee_amount"]` > 0 and
     equal to `int(round(platform_fee * 100))`
3. **Guard failures** — unit tests confirming:
   - No merchant row → 400 `merchant_stripe_not_connected`
   - `charges_enabled=False` → 400 `merchant_stripe_not_verified`
4. **Webhook branch** — unit test that pushes an `account.updated`
   event with mocked Account data and confirms the merchants row
   gets the right status.

Live verification after deploy (external, not Claude):

- Julian completes Stripe OAuth → `merchants` row shows
  `stripe_connect_id` set.
- `GET /api/merchant/stripe-connect/status` returns
  `charges_enabled: true` once Stripe's identity review clears.
- A real customer checks out the $850 Annual Inspection → Stripe
  dashboard shows the payment in Topgun's account with a
  platform-fee line.
- Money lands in Topgun's bank per Stripe's normal payout
  schedule.

## Files touched

- `backend/api/routes/checkout.py`
- `backend/api/routes/merchant.py`
- `CLAUDE.md`

No new files. No schema migrations. No frontend. No dependency
changes. No lockfile churn.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
