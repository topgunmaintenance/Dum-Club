-- 060_overage_billing.sql
-- Phase 3b: schema for livestream viewer-hour overage billing.
--
-- Two additive pieces:
--   1. merchants.stripe_customer_id — needed to attach Stripe
--      InvoiceItems to the merchant's customer record on the platform
--      Stripe account. (NOT the merchant's Connect account; that's
--      stripe_connect_id, which is for payouts TO the merchant.)
--      Note: migration 043 originally introduced this column but was
--      never applied to prod. This re-declares it idempotently via
--      ADD COLUMN IF NOT EXISTS so prod converges without depending
--      on 043 being applied separately.
--
--   2. merchant_overage_invoices — idempotency + audit table for
--      monthly overage calculations. One row per (merchant_id, yyyymm).
--      UNIQUE constraint prevents double-invoicing the same period.
--      Status enum records WHY a period wasn't charged (overage 0,
--      offset by sales fee, no customer id, etc).
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- * Does not back-apply migration 043 wholesale (still ships only the
--   one column 3b needs). Trial-subscription / grandfathered work
--   surfaced by today's audit is tracked separately.
-- * Does not write to orders, payouts, or Stripe accounts.
-- * Does not auto-run any overage calculation. The admin endpoint
--   is the only trigger.
--
-- ROLLBACK
-- --------
-- See rollback/060_rollback.sql. DROP TABLE merchant_overage_invoices
-- + DROP COLUMN merchants.stripe_customer_id. Both safe — the column
-- and table are read-with-fallback; absence means "Stripe Customer
-- workflow not yet active for this merchant" which is the pre-3b state.

BEGIN;

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS stripe_customer_id varchar;

COMMENT ON COLUMN public.merchants.stripe_customer_id IS
  'Stripe Customer object id (cus_*) for the platform-side billing '
  'relationship. Required by overage InvoiceItem creation in '
  'services/overage_billing.py. NULL means the platform has not yet '
  'attached this merchant to a Stripe Customer (Phase 3b records the '
  'overage calculation but skips the Stripe API call).';

CREATE TABLE IF NOT EXISTS public.merchant_overage_invoices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id              uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  yyyymm                   text NOT NULL,
  hours_used               numeric(12,4) NOT NULL,
  included_vh              numeric(12,4) NOT NULL,
  overage_hours            numeric(12,4) NOT NULL,
  overage_rate             numeric(6,4)  NOT NULL,
  overage_owed_cents       bigint        NOT NULL,
  sales_fee_earned_cents   bigint        NOT NULL,
  net_overage_cents        bigint        NOT NULL,
  stripe_invoice_item_id   text,
  status                   text NOT NULL,
  error                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  invoiced_at              timestamptz,

  CONSTRAINT ck_overage_status CHECK (status IN (
    'calculated',
    'invoiced',
    'skipped_no_overage',
    'skipped_offset_by_sales_fee',
    'skipped_no_customer',
    'failed'
  )),
  CONSTRAINT ck_overage_nonneg CHECK (
    hours_used             >= 0 AND
    included_vh            >= 0 AND
    overage_hours          >= 0 AND
    overage_owed_cents     >= 0 AND
    sales_fee_earned_cents >= 0 AND
    net_overage_cents      >= 0
  ),
  CONSTRAINT ux_overage_per_period UNIQUE (merchant_id, yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_overage_invoices_yyyymm
  ON public.merchant_overage_invoices(yyyymm);

COMMENT ON TABLE public.merchant_overage_invoices IS
  'One row per (merchant, billing month) overage calculation. UNIQUE on '
  '(merchant_id, yyyymm) provides idempotency: a second invocation of '
  'the calculation+invoice flow for the same period returns the existing '
  'row instead of double-charging. Records the WHY behind every skip '
  '(no overage / offset by sales fee / no customer id) so operator audit '
  'never has to guess.';

COMMENT ON COLUMN public.merchant_overage_invoices.status IS
  'calculated: computed but not yet invoiced (intermediate). '
  'invoiced: Stripe InvoiceItem created successfully. '
  'skipped_no_overage: hours_used <= included_vh. '
  'skipped_offset_by_sales_fee: overage_owed > 0 but sales_fee_earned offsets it (CLAUDE.md §3 no-double-bill). '
  'skipped_no_customer: net_overage > 0 but merchants.stripe_customer_id is NULL (operator must attach customer first). '
  'failed: Stripe API call errored; error column has detail.';

ALTER TABLE public.merchant_overage_invoices ENABLE ROW LEVEL SECURITY;
-- No policies = deny all to anon/authenticated. Operator-only data
-- accessed via service-role connection. Matches migration 048 telemetry.

COMMIT;
