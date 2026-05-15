-- 043_merchant_trial_subscription.sql
-- Add Stripe-Subscription-backed 60-day free-trial columns to the merchants
-- table. The trial timer + auto-conversion + dunning are all owned by Stripe
-- once the merchant has a stripe_subscription_id; these columns are denormalised
-- read-side cache so the dashboard countdown doesn't have to round-trip Stripe
-- on every page load.
--
-- Architecture: Option A from the pre-launch audit. On signup we
-- stripe.Customer.create + stripe.Subscription.create with
--   trial_period_days = 60
--   trial_settings.end_behavior.missing_payment_method = "pause"
-- so no card is required at signup. The merchant has 60 days to add a payment
-- method via the existing Stripe Connect flow's hosted form; if they don't,
-- Stripe pauses the subscription at trial end rather than auto-charging.
-- Webhooks fan-out from checkout.py keep the columns below in sync.
--
-- Grandfathering: every existing founding_merchant=true row at the time this
-- migration runs gets grandfathered=true so they are excluded from the trial
-- flow at /api/merchant/signup. Their pricing rule (founding-100, $0 forever)
-- stands per CLAUDE.md doctrine.
--
-- Safe to re-run.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS trial_start_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR,
  ADD COLUMN IF NOT EXISTS subscription_price_id  VARCHAR,
  ADD COLUMN IF NOT EXISTS next_billing_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grandfathered          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_trial_reminder    VARCHAR;

COMMENT ON COLUMN merchants.trial_start_at IS
  'When the 60-day free trial started. Set on signup. NULL for grandfathered + pre-launch rows.';
COMMENT ON COLUMN merchants.trial_ends_at IS
  'Computed trial expiry. Authoritative copy is stripe.Subscription.trial_end; this column is the cached read-side denormalisation.';
COMMENT ON COLUMN merchants.stripe_customer_id IS
  'Stripe Customer object id (cus_*). One per merchant. Separate from stripe_connect_id (acct_*) — that one is the merchant_s OWN connected account for receiving payouts.';
COMMENT ON COLUMN merchants.stripe_subscription_id IS
  'Stripe Subscription object id (sub_*). The platform-side recurring charge. Webhook-synced.';
COMMENT ON COLUMN merchants.subscription_price_id IS
  'Stripe Price object id (price_*) selected at signup. Default: STRIPE_PRICE_ID_GROWTH env.';
COMMENT ON COLUMN merchants.next_billing_at IS
  'Next invoice date if subscription is in trialing or active state. NULL when paused/cancelled.';
COMMENT ON COLUMN merchants.grandfathered IS
  'True if this merchant is exempt from the standard 60-day trial flow. Backfilled true for all founding_merchant=true rows that existed before this migration.';
COMMENT ON COLUMN merchants.last_trial_reminder IS
  'Last trial-reminder email tag sent (d-14, d-7, d-1, converted, payment_failed). Used by the daily reminder cron to avoid double-sends.';

-- Index supporting the daily reminder cron — scan merchants whose trial ends
-- in the next 14 days. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_merchants_trial_ends_at
  ON merchants(trial_ends_at)
  WHERE trial_ends_at IS NOT NULL AND grandfathered = false;

-- Backfill: every existing founding merchant is grandfathered. They keep their
-- $0 founding pricing per CLAUDE.md doctrine and never enter the trial flow.
UPDATE merchants
SET    grandfathered = true
WHERE  founding_merchant = true
  AND  grandfathered = false;

-- Sanity check.
DO $$
DECLARE
  total_merchants INTEGER;
  grandfathered_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_merchants FROM merchants;
  SELECT COUNT(*) INTO grandfathered_count FROM merchants WHERE grandfathered = true;
  RAISE NOTICE 'merchant trial schema: total=%, grandfathered=%', total_merchants, grandfathered_count;
END $$;
