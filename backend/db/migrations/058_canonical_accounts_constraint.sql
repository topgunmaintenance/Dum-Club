-- 058_canonical_accounts_constraint.sql
-- Phase F of the canonical-ownership migration.
--
-- WHY
-- ---
-- After 057 deactivates the duplicate Topgun merchant row, there is
-- exactly one ACTIVE merchant per business_profile_id. Lock that in
-- with a partial unique index so a future code path can never silently
-- create a second active billing row for the same LLC (which is what
-- caused the founding-slot-1/2 dup and two-Stripe-Connect-accounts mess
-- discovered in the 2026-05-26 audit).
--
-- THE CONSTRAINT
-- --------------
-- UNIQUE on merchants(business_profile_id) WHERE active = true.
-- Partial: only enforced on active rows, so historical inactive rows
-- (like our newly-deactivated c898ae74) are unconstrained and preserve
-- audit history.
--
-- DEPENDENCIES
-- ------------
-- Requires 057 to have run successfully — otherwise this index would
-- fail to create with a unique-violation error on the existing dup.
--
-- IDEMPOTENCY
-- -----------
-- CREATE UNIQUE INDEX IF NOT EXISTS. Second run is a no-op.
--
-- ROLLBACK
-- --------
-- DROP INDEX IF EXISTS public.ux_merchants_one_active_per_business;

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_merchants_one_active_per_business
  ON public.merchants(business_profile_id)
  WHERE active = true AND business_profile_id IS NOT NULL;

COMMENT ON INDEX public.ux_merchants_one_active_per_business IS
  'At most one active merchant row per business_profile. Partial index, '
  'inactive rows unconstrained for audit history. Added by migration 058 '
  'after 2026-05-26 audit found two active Topgun merchants with '
  'separate Stripe Connect accounts (one LIVE, one TEST-mode).';

COMMIT;
