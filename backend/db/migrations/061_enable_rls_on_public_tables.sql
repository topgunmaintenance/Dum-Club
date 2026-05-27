-- 061_enable_rls_on_public_tables.sql
-- SECURITY FIX (launch blocker): enable Row Level Security on every
-- public-schema table that PostgREST exposes via the Supabase anon key.
--
-- BACKGROUND
-- ----------
-- Supabase's anon key ships in the frontend bundle by default — any
-- visitor to dum.club can read it from devtools and hit the
-- /rest/v1/<table> endpoint directly. A table in the public schema
-- with RLS disabled is therefore world-readable and world-writable
-- regardless of any frontend code.
--
-- TODAY'S ADVISOR SAID
-- --------------------
--   ERROR  rls_disabled_in_public  public.investor_leads
--   ERROR  rls_disabled_in_public  public.accounts
--   ERROR  rls_disabled_in_public  public.account_logins
--   ERROR  rls_disabled_in_public  public.trial_reminder_log
--
-- Of these, accounts + account_logins are the most dangerous: an
-- attacker with the anon key could UPDATE accounts.primary_email on
-- the canonical Julian account or INSERT account_logins rows to
-- impersonate any Privy DID. That's a direct dashboard / merchant
-- takeover.
--
-- The other 7 INFO-level findings (RLS enabled but no policy) were
-- already safe (no policy = no access from anon), but advisor flags
-- them as ambiguous. Adding an explicit `deny_all` policy clarifies
-- the intent and silences the linter. Operator-only tables use
-- the service_role key, which bypasses RLS regardless of policy.
--
-- WHY THIS IS SAFE TO APPLY
-- -------------------------
-- Verified by `grep "\.from('"` across frontend/: none of the tables
-- touched here are accessed directly from the browser. Every code
-- path goes through the FastAPI backend, which uses the service_role
-- key. Service role bypasses RLS, so backend behavior is unchanged.
--
-- ROLLBACK
-- --------
-- rollback/061_rollback.sql — drops the deny_all policies and
-- disables RLS on the 4 originally-disabled tables. Other tables
-- keep their RLS state (which was already enabled before this
-- migration).

BEGIN;

-- ============================================================
-- Group A: enable RLS on the 4 currently-disabled tables.
-- These have the deepest blast radius if exploited.
-- ============================================================

ALTER TABLE public.investor_leads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_logins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_reminder_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Group B: deny_all policies on every operator-only table.
-- Service role bypasses RLS, so backend writes/reads keep working.
-- `FOR ALL USING (false)` denies SELECT/INSERT/UPDATE/DELETE/TRUNCATE
-- to anon and authenticated roles in one policy.
--
-- DROP POLICY IF EXISTS first so this migration is re-runnable
-- against the partially-deny_all'd state in prod.
-- ============================================================

-- 4 newly-protected tables (Group A above).
DROP POLICY IF EXISTS deny_all ON public.investor_leads;
CREATE POLICY deny_all ON public.investor_leads     FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.accounts;
CREATE POLICY deny_all ON public.accounts           FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.account_logins;
CREATE POLICY deny_all ON public.account_logins     FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.trial_reminder_log;
CREATE POLICY deny_all ON public.trial_reminder_log FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 7 tables that have RLS enabled but no policy (advisor INFO finding).
-- Adding deny_all makes the intent explicit + silences the advisor.
DROP POLICY IF EXISTS deny_all ON public.merchant_analytics_events;
CREATE POLICY deny_all ON public.merchant_analytics_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchant_monthly_usage;
CREATE POLICY deny_all ON public.merchant_monthly_usage    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchant_overage_invoices;
CREATE POLICY deny_all ON public.merchant_overage_invoices FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchant_plan_limits;
CREATE POLICY deny_all ON public.merchant_plan_limits      FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.plan_limits;
CREATE POLICY deny_all ON public.plan_limits               FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.stream_sessions;
CREATE POLICY deny_all ON public.stream_sessions           FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.viewer_session_events;
CREATE POLICY deny_all ON public.viewer_session_events     FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ============================================================
-- Sanity check — count tables in public with rls_enabled=false.
-- Expected: 0.
-- ============================================================
DO $$
DECLARE
  unprotected_count int;
BEGIN
  SELECT COUNT(*) INTO unprotected_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false;
  IF unprotected_count > 0 THEN
    RAISE NOTICE '061 sanity: % public table(s) still have RLS disabled '
                 '(non-fatal — they may be intentional, but inspect).',
                 unprotected_count;
  END IF;
END $$;

COMMIT;
