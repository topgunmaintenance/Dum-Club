-- 053_plan_limits_zero_commission.sql
-- Reconcile plan_limits.commission_rate with doctrine. CLAUDE.md §10 and
-- absolute rule §12.1 state seller commission is 0% — always, for everyone,
-- forever. Migration 049 seeded every tier with commission_rate = 0.0100
-- (1%); this migration zeroes every row so PR-COMM's resolver, when it
-- falls through to the plan default for a merchant whose override is NULL,
-- returns Decimal("0.0000") on every tier instead of 1%.
--
-- This is a DATA migration, not a schema migration. The column shape
-- (NUMERIC(5,4) NULL-able, bounds CHECK 0..0.5) is unchanged. The 0.5
-- upper bound stays so the column can record a non-zero rate IF doctrine
-- ever changes in the future — but right now, every row is 0.0000.
--
-- The 1% buyer-side margin mentioned in CLAUDE.md §4 (Stream 5) is
-- explicitly NOT applied via plan_limits.commission_rate. If/when that
-- buyer margin ships, it belongs in a separate column on a separate
-- concern. PR-COMM treats plan_limits.commission_rate exclusively as
-- seller-side commission, which is 0%.
--
-- Pre-migration prod state (verified via execute_sql at task time):
--   starter, growth, pro, business, enterprise — every row 0.0100.
-- Post-migration state: every row 0.0000.
--
-- Audit note (recorded here so future grep finds it):
-- The prereq check at task time also surfaced 34 historical orders with
-- platform_fee_usd > 0, all at an implied 7% rate, totalling $242.41
-- (13 real Stripe-PI orders = $138.32; 8 real-no-PI = $65.10; 13 demo
-- seed rows = $38.99). Those rows pre-date PR-COMM and the current
-- hardcoded PLATFORM_FEE_RATE = 0.0; this migration does NOT modify
-- orders, so historical fee amounts on those rows are preserved exactly
-- as they were settled. Merchant reconciliation for the $138.32 real
-- skim is a separate, out-of-band conversation outside this migration.
--
-- IS DISTINCT FROM makes the UPDATE idempotent — running it a second time
-- touches zero rows. It also normalizes any tier accidentally set to NULL
-- to 0.0000, which is doctrine-correct (NULL "fails closed" but 0.0000
-- explicitly states "no commission"; doctrine wants explicit).
--
-- Rollback (restores the 049 seed values verbatim):
--   UPDATE plan_limits SET commission_rate = 0.0100;

UPDATE plan_limits
   SET commission_rate = 0.0000,
       updated_at      = now()
 WHERE commission_rate IS DISTINCT FROM 0.0000;
