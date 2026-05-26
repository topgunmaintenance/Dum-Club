-- 060_rollback.sql — reverses migration 060_overage_billing.
--
-- SAFE because:
--   * stripe_customer_id is read-with-fallback: services/overage_billing.py
--     treats NULL as "no Stripe customer yet" and records status='skipped_no_customer'.
--     Dropping the column means every overage call records 'skipped_no_customer',
--     which is the pre-Phase-3b behavior.
--   * merchant_overage_invoices has no readers outside the overage service.
--     Dropping it removes the idempotency table; future calls would have
--     no protection against double-invoicing, so re-add before re-running.

BEGIN;

DROP INDEX IF EXISTS public.idx_overage_invoices_yyyymm;
DROP TABLE IF EXISTS public.merchant_overage_invoices;
ALTER TABLE public.merchants DROP COLUMN IF EXISTS stripe_customer_id;

COMMIT;
