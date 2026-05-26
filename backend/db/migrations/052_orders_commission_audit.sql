-- 052_orders_commission_audit.sql
-- Audit columns on orders so every order created post-PR-COMM records
-- (a) the commission rate that was resolved at session-create time, and
-- (b) the exact integer cents value sent to Stripe as application_fee_amount.
-- Without these, reverse-deriving which rate was applied to a given order
-- requires floating-point math on the existing platform_fee_usd (NUMERIC(10,2),
-- dollars). At small amounts that math is ambiguous; the new columns capture
-- the decision input (rate) and the decision output (cents) directly.
--
-- Both columns are NULL-able. No backfill is performed: pre-existing orders
-- pre-date PR-COMM and have no resolved rate to record. Going forward:
--   * /create-payment-intent writes BOTH columns (Stripe sale path).
--   * /sol-confirm writes resolved_commission_rate ONLY and leaves
--     application_fee_amount_cents NULL — no Stripe call is made in the
--     SOL flow, so there is no fee_amount value to record. The audit rate
--     still gets stamped so reconciliation can compute what the platform
--     would have skimmed if/when SOL settlement-to-merchant lands.
--
-- Column bounds:
--   resolved_commission_rate     — NULL or [0, 0.5]. Same bound as the
--                                  source columns (merchants.commission_rate_override
--                                  from 050; plan_limits.commission_rate from 049).
--                                  Storing a value outside the source columns'
--                                  bounds would mean the resolver violated its
--                                  contract; the CHECK catches that at write time.
--   application_fee_amount_cents — NULL or >= 0. BIGINT, not INTEGER: signed
--                                  INTEGER tops out near $21.4M per order; BIGINT
--                                  handles enterprise / B2B-white-label edge cases
--                                  without ever needing to re-migrate. Stripe
--                                  enforces the upper bound at API call time.
--
-- Backward compatibility: the existing orders.platform_fee_usd NUMERIC(10,2)
-- column is preserved untouched. PR-COMM continues to write it alongside the
-- new columns so existing readers (analytics queries, recent-sales endpoint,
-- seller dashboards) are unaffected. The relationship at write time is:
--   platform_fee_usd = application_fee_amount_cents / 100.0
--
-- Rollback:
--   ALTER TABLE orders DROP CONSTRAINT ck_orders_resolved_commission_rate_bounds;
--   ALTER TABLE orders DROP CONSTRAINT ck_orders_application_fee_cents_nonneg;
--   ALTER TABLE orders DROP COLUMN resolved_commission_rate;
--   ALTER TABLE orders DROP COLUMN application_fee_amount_cents;
-- Nothing reads these columns yet (PR-COMM lands after this migration), so
-- the drop is clean and total.

ALTER TABLE orders
    ADD COLUMN resolved_commission_rate NUMERIC(5,4);

ALTER TABLE orders
    ADD COLUMN application_fee_amount_cents BIGINT;

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_resolved_commission_rate_bounds
    CHECK (resolved_commission_rate IS NULL
           OR (resolved_commission_rate >= 0
               AND resolved_commission_rate <= 0.5));

ALTER TABLE orders
    ADD CONSTRAINT ck_orders_application_fee_cents_nonneg
    CHECK (application_fee_amount_cents IS NULL
           OR application_fee_amount_cents >= 0);
