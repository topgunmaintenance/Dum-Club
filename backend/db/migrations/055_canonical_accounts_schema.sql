-- 055_canonical_accounts_schema.sql
-- Phase A of the canonical-ownership migration (audit dated 2026-05-26).
--
-- WHY THIS EXISTS
-- ---------------
-- Today every "who owns this business" relationship in DUM Club is keyed
-- off a Privy DID (`projects.privy_id`, `merchants.owner_privy_id`,
-- `business_profiles.owner_privy_id`). Privy mints a new DID every time
-- the same human logs in with a different provider, so a single founder
-- ends up with N DIDs and their businesses orphan from the dashboard.
--
-- The audit confirmed: jmero1@gmail.com / julian@topgunmaintenance.com /
-- julian@dum.club (x2) / one anonymous Google session are five DIDs for
-- the same person, and Topgun Maintenance LLC's identity is fragmented
-- across all of them plus a `seed:topgun-maintenance` marker.
--
-- This migration introduces a canonical account layer that survives
-- Privy session churn:
--
--     accounts (1) ── (N) account_logins  (Privy DIDs map here)
--          │
--          └── (N) business_profiles      (legal LLC layer)
--                       │
--                       └── (N) projects  (storefronts under the LLC)
--                       └── (N) merchants (billing / Stripe)
--
-- WHAT THIS FILE DOES
-- -------------------
-- Pure DDL. No row data is modified. New nullable `account_id` columns
-- are added to projects, merchants, and business_profiles so backfill
-- in 056-057 can happen non-blockingly. The existing column
-- `projects.business_profile_id` (already present but with no FK
-- enforcement) is upgraded to a real FK.
--
-- This file MUST run before 056-058. Order: 055 → 056 → 057 → 058.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- - Does not touch orders, offers, dum_transactions, redemptions,
--   purchase_proofs, merchant_analytics_events, ai_agent_*, auctions,
--   bookings, service_profiles, livestream/replay/view_count columns,
--   store_items, or any token-related column.
-- - Does not modify `users` or `profiles` tables (legacy identity tables;
--   they stay as-is for backward compatibility per founder direction).
-- - Does not drop any column, table, or constraint. Legacy `privy_id`,
--   `owner_privy_id`, and `owner_id` columns stay populated so existing
--   reads keep working through the transition window.
--
-- IDEMPOTENCY
-- -----------
-- Every statement uses IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- guarded ALTER. Re-running this migration touches zero rows and is a
-- no-op against a database where it has already applied.
--
-- ROLLBACK
-- --------
-- See backend/db/migrations/rollback/055_058_canonical_accounts_rollback.sql.
-- Schema rollback is intentionally a NO-OP for this file — additive
-- columns and tables stay in place because dropping them mid-rollback
-- requires zero readers, which can't be guaranteed without coordinated
-- code deploy. If a true schema teardown is needed later, see the
-- "DEEP ROLLBACK" section in the rollback file.

BEGIN;

-- ----------------------------------------------------------------
-- 1. accounts — canonical login owner (1 row per human/organization)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_email text NOT NULL UNIQUE,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.accounts IS
  'Canonical account/owner identity. One row per human or organization. '
  'Authoritative for ownership of projects, merchants, and business_profiles. '
  'Decoupled from Privy DIDs (which live in account_logins, N per account).';
COMMENT ON COLUMN public.accounts.primary_email IS
  'Email the account-holder uses to log in. Unique. Not necessarily the '
  'business_email of any business owned by this account.';

-- ----------------------------------------------------------------
-- 2. account_logins — N Privy DIDs per account
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_logins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  privy_did    text NOT NULL UNIQUE,
  provider     text,           -- 'google' | 'email' | 'wallet' | 'seed' | other
  linked_email text,           -- email observed at this login; NOT authoritative
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_logins_account_id
  ON public.account_logins(account_id);

COMMENT ON TABLE  public.account_logins IS
  'Mapping from Privy DID -> canonical account. Every Privy session (Google '
  'login, email login, wallet login, etc.) creates a row here. Lookup pattern '
  'on auth: WHERE privy_did = <session DID> -> account_id.';
COMMENT ON COLUMN public.account_logins.privy_did IS
  'The "did:privy:..." string from Privy. UNIQUE: a DID can only belong to '
  'one account. To merge identities, manually re-point this row.';
COMMENT ON COLUMN public.account_logins.linked_email IS
  'Email the user authenticated with at this Privy session. Snapshot only. '
  'Authoritative email lives on accounts.primary_email.';

-- ----------------------------------------------------------------
-- 3. account_id columns on existing tables (NULLABLE during backfill window)
-- ----------------------------------------------------------------
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);
ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.accounts(id);

COMMENT ON COLUMN public.business_profiles.account_id IS
  'Canonical account that owns this business profile. Replaces owner_privy_id. '
  'NULL allowed during the 055-058 transition window; tightened later.';
COMMENT ON COLUMN public.projects.account_id IS
  'Canonical account that owns this storefront. Denormalized from '
  'business_profiles.account_id for fast dashboard listing. NULL allowed '
  'during the 055-058 transition window.';
COMMENT ON COLUMN public.merchants.account_id IS
  'Canonical account that owns this billing/Stripe merchant row. Replaces '
  'owner_privy_id. NULL allowed during the 055-058 transition window.';

-- ----------------------------------------------------------------
-- 4. FK on projects.business_profile_id (column exists, FK does not)
-- ----------------------------------------------------------------
-- Without this FK, projects can reference non-existent business_profiles.
-- Audit found 1 project (Topgun) with business_profile_id set; everything
-- else is NULL, so adding the FK now is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema    = 'public'
       AND table_name      = 'projects'
       AND constraint_type = 'FOREIGN KEY'
       AND constraint_name = 'projects_business_profile_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_business_profile_id_fkey
      FOREIGN KEY (business_profile_id) REFERENCES public.business_profiles(id);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 5. Performance indexes for the new lookup patterns
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_projects_account_id
  ON public.projects(account_id);
CREATE INDEX IF NOT EXISTS idx_projects_business_profile_id
  ON public.projects(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_merchants_account_id
  ON public.merchants(account_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_account_id
  ON public.business_profiles(account_id);

COMMIT;
