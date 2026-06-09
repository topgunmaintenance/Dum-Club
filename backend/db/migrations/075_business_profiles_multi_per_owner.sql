-- Migration 075: allow many distinct business profiles per owner/login,
-- and allow a standalone business profile with no storefront yet.
--
-- WHY
-- ---
-- The live business_profiles table carried two per-DID UNIQUE caps
-- (owner_privy_id, privy_id) that limited an account to ONE business,
-- and a NOT NULL project_id that tied every profile to a storefront.
-- Together they (a) blocked multi-business-per-account and (b) made
-- POST /api/business/create crash: the handler's INSERT never set
-- privy_id (NOT NULL) or project_id (NOT NULL), so the raw NOT-NULL
-- violation surfaced as a CORS-stripped 500 ("Failed to fetch").
--
-- Confirmed via preflight: business_profiles held exactly ONE row
-- (Topgun, project_id + privy_id populated, single per owner), so every
-- statement below is a no-op against existing data.
--
-- KEEP (unchanged): business_profiles_project_id_fkey (project_id ->
-- projects ON DELETE CASCADE), business_profiles_account_id_fkey,
-- the primary key, and privy_id NOT NULL (the create handler now
-- populates privy_id from the session DID).
--
-- Applied to prod via Supabase MCP apply_migration ahead of the code
-- merge; this file is the repo record. Forward-only; idempotent via
-- DROP CONSTRAINT IF EXISTS + a re-runnable ALTER.

-- (a) Drop the per-DID UNIQUE constraints so one owner_privy_id /
--     privy_id can back many distinct businesses.
ALTER TABLE public.business_profiles
  DROP CONSTRAINT IF EXISTS business_profiles_owner_privy_id_key;
ALTER TABLE public.business_profiles
  DROP CONSTRAINT IF EXISTS business_profiles_privy_id_key;

-- (b) Relax project_id so a brand-new account with no project yet can
--     still create a business. The FK is KEPT — a non-null project_id
--     must still point at a real project; only NULL is now allowed.
ALTER TABLE public.business_profiles
  ALTER COLUMN project_id DROP NOT NULL;
