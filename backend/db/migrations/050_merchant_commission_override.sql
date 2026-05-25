-- 050_merchant_commission_override.sql
-- Per-MERCHANT commission rate override. Pairs with migration 049's
-- plan_limits.commission_rate to give the rate-resolution function (built
-- in PR-COMM) its full input. Resolution order at sale time is:
--     merchants.commission_rate_override   -- this column
--  -> plan_limits.commission_rate          -- migration 049
--  -> raise (fail closed, sale setup aborts).
--
-- NULL vs 0.0000 semantics (both are legal values, with distinct meaning):
--   NULL    = unset. Use the plan default from plan_limits. This is the
--             intended state for every existing merchant on the day this
--             migration ships; no backfill is performed.
--   0.0000  = deliberate comp / promo. The merchant pays no commission on
--             this account by explicit operator decision. Resolution code
--             MUST use `is not None` checks, never truthiness, so a 0.00
--             override is preserved rather than silently falling through
--             to the plan default.
--
-- Column is NULL-able because that's the inheritance signal. Bounds are
-- enforced by a CHECK constraint: NULL is allowed, otherwise the rate must
-- be in [0, 0.5] (matching the plan_limits.commission_rate bound). No
-- index is added: low-cardinality column, only read in single-row lookups
-- by merchant primary key.
--
-- Rollback:
--   ALTER TABLE merchants DROP CONSTRAINT ck_commission_rate_override_bounds;
--   ALTER TABLE merchants DROP COLUMN commission_rate_override;
-- Nothing reads this column yet (PR-COMM lands separately), so the drop
-- is clean and total.

ALTER TABLE merchants
    ADD COLUMN commission_rate_override NUMERIC(5,4);

ALTER TABLE merchants
    ADD CONSTRAINT ck_commission_rate_override_bounds
    CHECK (commission_rate_override IS NULL
           OR (commission_rate_override >= 0
               AND commission_rate_override <= 0.5));
