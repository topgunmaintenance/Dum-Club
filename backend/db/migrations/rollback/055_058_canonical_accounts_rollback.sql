-- 055_058_canonical_accounts_rollback.sql
-- Reverses migrations 055, 056, 057, 058 in safe order.
--
-- WHEN TO USE
-- -----------
-- Run if any of the following happens after applying 055-058 to prod:
--   - Phase G (dashboard backend rewrite) is reverted and ownership
--     resolution needs to fall back to legacy privy_id matching
--   - Founder decides the canonical-account architecture should be
--     re-designed before going live
--   - Verification queries (verify/055_058_canonical_accounts_verify.sql)
--     fail in production after deploy
--
-- SAFETY GUARANTEES
-- -----------------
-- This rollback is SAFE because:
--   1. The 055-057 migrations never modified legacy identity columns
--      (projects.privy_id, projects.owner_id, business_profiles.privy_id,
--      business_profiles.owner_privy_id, merchants.owner_privy_id all
--      stayed populated). The legacy dashboard query path still works
--      mid-rollback.
--   2. No orders, payment intents, Stripe Connect IDs, analytics events,
--      ai_agent rows, livestream data, or inventory rows were modified
--      by 055-057.
--   3. The deactivated merchant (c898ae74) is reactivated by this
--      rollback. Its Stripe Connect ID was never touched, so reactivation
--      restores the pre-migration billing surface exactly.
--
-- WHAT THIS FILE DROPS / REVERSES
-- -------------------------------
--   - Phase F: drop the partial unique index (ux_merchants_one_active_per_business)
--   - Phase E: clear merchants.account_id on both rows; reactivate
--              c898ae74 (active=true, subscription_status='active');
--              clear merchants.business_profile_id on c898ae74
--   - Phase D: clear projects.account_id on both Topgun + Silver Market Hub;
--              clear projects.business_profile_id on Silver Market Hub
--              (Topgun's business_profile_id existed pre-migration and is
--              preserved)
--   - Phase C: clear business_profiles.account_id, business_email, and
--              email_domain on Topgun row
--   - Phase B: delete the 5 account_logins rows for Julian; delete the
--              accounts row for jmero1@gmail.com
--
-- WHAT THIS FILE INTENTIONALLY DOES NOT DO
-- ----------------------------------------
-- Schema rollback (Phase A) is a NO-OP. The new tables (accounts,
-- account_logins) and new columns (account_id on 3 tables) stay in
-- place. Dropping them mid-rollback is unsafe without coordinated code
-- deploy — any code still referencing account_id would crash. If a true
-- schema teardown is needed, see DEEP_ROLLBACK at the bottom of this
-- file.
--
-- IDEMPOTENCY
-- -----------
-- All UPDATE/DELETE statements use WHERE clauses that guard against
-- re-application. Safe to run multiple times.
--
-- HOW TO RUN
-- ----------
-- psql ... -f backend/db/migrations/rollback/055_058_canonical_accounts_rollback.sql
-- or via Supabase MCP execute_sql / apply_migration.

BEGIN;

-- ----------------------------------------------------------------
-- Phase F reverse: drop the partial unique index
-- ----------------------------------------------------------------
DROP INDEX IF EXISTS public.ux_merchants_one_active_per_business;

-- ----------------------------------------------------------------
-- Phase E reverse: reactivate deactivated merchant, clear account_id
-- ----------------------------------------------------------------
-- Reactivate dup merchant c898ae74.
-- Defensive: refuse to touch if stripe_connect_id has drifted.
UPDATE public.merchants
   SET active              = true,
       subscription_status = 'active',
       account_id          = NULL,
       business_profile_id = NULL  -- restore pre-migration state (was NULL)
 WHERE id                = 'c898ae74-e979-417e-8118-a9d5ef99b10c'
   AND stripe_connect_id = 'acct_1TG74OBqrR2Kx0BP';

-- Clear account_id on kept merchant e8dfb42c (business_profile_id was
-- already set pre-migration so it stays).
UPDATE public.merchants
   SET account_id = NULL
 WHERE id                = 'e8dfb42c-1134-48d3-8615-9ec5ac07e79e'
   AND stripe_connect_id = 'acct_1TRY4h1Q55Fqu9MS';

-- ----------------------------------------------------------------
-- Phase D reverse: clear projects.account_id; revert Silver Market Hub's
-- business_profile_id to NULL (Topgun's stays set, pre-migration value)
-- ----------------------------------------------------------------
UPDATE public.projects
   SET account_id          = NULL,
       business_profile_id = NULL  -- pre-migration state for Silver Market Hub
 WHERE id   = '613d414c-d941-4f23-9ffe-cff41546fc01'
   AND name = 'Silver Market Hub';

UPDATE public.projects
   SET account_id = NULL
       -- business_profile_id stays 'd6c40d05...' — that was the pre-migration value
 WHERE id   = 'bc43652f-1426-4039-9086-a8be5d28d144'
   AND name = 'Topgun Maintenance LLC';

-- ----------------------------------------------------------------
-- Phase C reverse: clear backfilled fields on business_profiles
-- ----------------------------------------------------------------
UPDATE public.business_profiles
   SET account_id     = NULL,
       business_email = NULL,
       email_domain   = NULL,
       updated_at     = now()
 WHERE id            = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'
   AND business_name = 'Topgun Maintenance LLC';

-- ----------------------------------------------------------------
-- Phase B reverse: delete the 5 account_logins + the 1 accounts row
-- ----------------------------------------------------------------
-- account_logins go first (FK ON DELETE CASCADE would also handle this,
-- but explicit is safer for audit).
DELETE FROM public.account_logins
 WHERE account_id IN (
   SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'
 );

DELETE FROM public.accounts
 WHERE primary_email = 'jmero1@gmail.com';

-- ----------------------------------------------------------------
-- Post-flight sanity checks
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE primary_email = 'jmero1@gmail.com') THEN
    RAISE EXCEPTION 'Rollback failed: accounts row still present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.projects
     WHERE id IN ('bc43652f-1426-4039-9086-a8be5d28d144','613d414c-d941-4f23-9ffe-cff41546fc01')
       AND account_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Rollback failed: project account_id still set';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants
     WHERE id='c898ae74-e979-417e-8118-a9d5ef99b10c' AND active = true
  ) THEN
    RAISE EXCEPTION 'Rollback failed: dup merchant did not reactivate';
  END IF;
END $$;

COMMIT;

-- ================================================================
-- DEEP_ROLLBACK (manual, separate operation — DO NOT run as part of the
-- standard rollback above).
--
-- Only run this if every reader of accounts/account_logins/account_id
-- has been removed from production code and you want to truly tear the
-- schema down. Order matters: indexes, then columns, then tables.
-- ================================================================
-- DROP INDEX  IF EXISTS public.idx_business_profiles_account_id;
-- DROP INDEX  IF EXISTS public.idx_merchants_account_id;
-- DROP INDEX  IF EXISTS public.idx_projects_business_profile_id;
-- DROP INDEX  IF EXISTS public.idx_projects_account_id;
-- ALTER TABLE public.projects          DROP CONSTRAINT IF EXISTS projects_business_profile_id_fkey;
-- ALTER TABLE public.merchants         DROP COLUMN     IF EXISTS account_id;
-- ALTER TABLE public.projects          DROP COLUMN     IF EXISTS account_id;
-- ALTER TABLE public.business_profiles DROP COLUMN     IF EXISTS account_id;
-- DROP TABLE  IF EXISTS public.account_logins;
-- DROP TABLE  IF EXISTS public.accounts;
