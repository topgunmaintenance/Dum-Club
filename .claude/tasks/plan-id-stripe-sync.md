TASK: plan-id-stripe-sync

Sync merchants.plan_id to the Stripe tier the merchant actually
pays for, and build a real upgrade flow. Today billing and
enforcement are two unconnected axes.

Problem:
merchants.plan_id - the key EVERY enforcement check resolves
through (viewer cap, stream cap, monthly hard block, commission) -
is written exactly once in the entire backend: hardcoded 'starter'
at signup. Meanwhile the Stripe subscription is created on the
REQUESTED tier, defaulting to 'growth'. Nothing ever updates
plan_id afterward, and the /upgrade page is not an upgrade flow -
its buttons link back to the signup page. Net effect: a merchant
whose trial converts pays Growth $99/mo while being enforced at
Starter caps (250 vh, 250 viewers, 1 stream), and the hard-block
error sends them to an /upgrade page that cannot upgrade them.
Cost-safe direction today, but a churn/support bomb and a billing-
integrity defect.

Evidence:
- plan_id hardcoded at signup, sole write site in backend:
  backend/api/routes/merchant.py:553-562 ("Upgrades change plan_id
  in a later billing PR")
- Stripe trial created on requested tier, default growth:
  backend/api/routes/merchant.py:685-703,
  backend/services/subscriptions.py:99-158
- Price-id env mapping (the only tier<->price linkage that exists):
  backend/services/subscriptions.py:52-54 and _resolve_price_id at
  72-92; read-side label map backend/api/routes/merchant.py:1055-1062
- /upgrade page links to signup, no checkout:
  frontend/app/upgrade/page.tsx:41-78
- Enforcement reads plan_id: backend/services/merchant_limits.py:
  110-172; commission: backend/services/commission.py:94-104
- Webhook already refreshes denormalised subscription fields:
  backend/services/subscriptions.py:204+ (update_merchant_from_
  subscription, called from checkout.py customer.subscription.*
  handlers) - the natural sync point.

Proposed approach:
1. Single source of truth mapping: price_id -> plan_id, derived
   from the existing STRIPE_PRICE_ID_* envs in one place (extend
   services/subscriptions.py). No hardcoded duplicate tables.
2. Sync on webhook: in update_merchant_from_subscription, when the
   subscription's active price maps to a known plan_id, write it to
   merchants.plan_id. Unknown price -> log loudly, change nothing
   (fail safe, never guess a tier).
3. Signup: set plan_id from the resolved tier at insert (same value
   the Stripe subscription is created with) instead of hardcoded
   'starter'.
4. Real upgrade flow: backend endpoint that swaps the subscription
   item's price via Stripe (proration per Stripe defaults), then
   relies on the webhook sync from (2) to flip plan_id. /upgrade
   buttons call it for signed-in merchants instead of linking to
   signup.
5. Downgrade = same mechanism; enforcement tightens on the webhook.

Enforcement-key consistency (the critical invariant):
- plan_id MUST only ever hold values present in plan_limits.plan_id
  (FK from migration 051 enforces this - keep it).
- The webhook sync and the signup write must use the SAME mapping
  function; two mappings will eventually disagree and someone gets
  enforced on the wrong tier.
- Business/enterprise are NOT self-serve: their caps are NULL in
  plan_limits and enforcement fails closed without a
  merchant_plan_limits override (merchant_limits.py:100-108). The
  upgrade flow must exclude them (contract sales path only) or set
  the override in the same transaction - never flip plan_id to a
  NULL-cap tier on its own.
- Founding-tier subscription lock (CLAUDE.md s3) covers the
  subscription PRICE, not enforcement caps - a founding merchant
  who upgrades tiers still maps by price_id like everyone else.
- Mid-cycle tier change straddling a billing month: overage and
  hard block read one plan_id at gate time; document that the
  month's limits follow the plan_id current at each gate check
  (simple, predictable) rather than prorating caps.

Gates - no silent prod changes:
- No migration expected (plan_id column + FK exist via 051/068).
  If one becomes necessary, STOP and queue it under the normal
  migration gate.
- The signup-default change and the webhook sync alter prod
  enforcement behavior for real merchants: ship behind a review,
  and include a one-time reconciliation report (read-only SQL:
  merchants whose subscription_price_id disagrees with plan_id)
  for Julian to approve BEFORE any backfill UPDATE is run. The
  backfill itself, if needed, is operator-run with the report in
  hand - not part of the deploy.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
