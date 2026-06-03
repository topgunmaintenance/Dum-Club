-- 068_backfill_merchant_plan_id.sql
-- Repair merchants left with plan_id = NULL.
--
-- Root cause: the merchant signup insert (api/routes/merchant.py) set
-- subscription_tier / plan_type ('founding' | 'standard') but never set
-- plan_id, so every merchant created after migration 051's one-time
-- backfill landed with plan_id = NULL again. Both resolvers that read
-- merchants.plan_id fail closed on NULL:
--   - services/merchant_limits.py -> Go Live blocked with the confusing
--     "contact support so we can set your stream caps" error
--   - services/commission.py      -> commission rate unresolved
--
-- The signup path now sets plan_id = 'starter' at insert; this migration
-- repairs the existing rows. Mapping mirrors migration 051; any row whose
-- plan_type is NULL or unmapped also defaults to the base 'starter' tier
-- so no merchant is left with plan_id IS NULL. All target values
-- ('starter', 'pro') are seeded in plan_limits by migration 049, so the
-- FK merchants.plan_id -> plan_limits(plan_id) stays valid.

UPDATE merchants
   SET plan_id = CASE plan_type
                   WHEN 'founding'  THEN 'starter'
                   WHEN 'standard'  THEN 'starter'
                   WHEN 'promoted'  THEN 'pro'
                   ELSE 'starter'
                 END
 WHERE plan_id IS NULL;
