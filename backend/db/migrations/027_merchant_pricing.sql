-- 027_merchant_pricing.sql
-- Founding Merchant Pricing System — adds plan_type, subscription_status,
-- and founding_slot_number to the merchants table (from 026_merchants.sql).
--
-- Founding cap is 50. Slots 1..50 get free-forever pricing, everyone after
-- defaults to the 'standard' plan. Stripe billing is NOT wired in this
-- migration — this is DB infrastructure only so the UI can show a
-- "X of 50 spots remaining" counter and the backend can enforce the cap.
--
-- NOTE: plan_type overlaps conceptually with the existing subscription_tier
-- column (both encode the merchant's pricing plan). We're adding plan_type
-- intentionally as requested; a future PR should consolidate the two by
-- dropping subscription_tier OR plan_type and migrating readers. Marking
-- this as tech debt in the column comment below.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS plan_type            VARCHAR NOT NULL DEFAULT 'founding',
  ADD COLUMN IF NOT EXISTS subscription_status  VARCHAR NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS founding_slot_number INTEGER;

-- Allowed values (enforced at application layer; add CHECK constraint later
-- once all historical rows are confirmed to comply):
--   plan_type:           'founding' | 'standard' | 'promoted'
--   subscription_status: 'active'   | 'paused'   | 'cancelled'
COMMENT ON COLUMN merchants.plan_type IS
  'Pricing plan: founding | standard | promoted. Overlaps with subscription_tier — consolidate in a future PR.';
COMMENT ON COLUMN merchants.subscription_status IS
  'Billing status: active | paused | cancelled. No Stripe wiring yet.';
COMMENT ON COLUMN merchants.founding_slot_number IS
  'Ordinal slot (1..50) for founding merchants. NULL for non-founding plans. Assigned atomically on signup.';

-- Backfill: every pre-existing founding merchant row gets a stable slot
-- derived from created_at order. This runs once on migration apply.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM merchants
  WHERE plan_type = 'founding'
    AND founding_slot_number IS NULL
)
UPDATE merchants m
SET    founding_slot_number = ranked.rn
FROM   ranked
WHERE  m.id = ranked.id
  AND  ranked.rn <= 50;

-- Any rows beyond slot 50 during backfill fall through to standard plan.
UPDATE merchants m
SET    plan_type = 'standard',
       founding_merchant = false
FROM (
  SELECT id
  FROM   merchants
  WHERE  plan_type = 'founding'
    AND  founding_slot_number IS NULL
) overflow
WHERE m.id = overflow.id;

-- Partial unique index: no two founding merchants can share a slot.
-- Non-founding rows have NULL slot numbers so they're excluded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_founding_slot
  ON merchants(founding_slot_number)
  WHERE founding_slot_number IS NOT NULL;

-- Query index for the founding-status endpoint (SELECT COUNT(*) WHERE plan_type='founding').
CREATE INDEX IF NOT EXISTS idx_merchants_plan_type
  ON merchants(plan_type)
  WHERE active = true;
