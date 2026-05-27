-- 061_rollback.sql — reverses 061_enable_rls_on_public_tables.
--
-- Drops every deny_all policy created by 061 and disables RLS on
-- the 4 originally-disabled tables. The other 7 tables keep their
-- pre-061 state (RLS enabled, zero policies — which 061's INFO
-- advisor flagged but did not require fixing).
--
-- WHEN TO USE
-- -----------
-- Run if the migration breaks an unexpected read path. Given that
-- every access goes through service_role (which bypasses RLS),
-- breakage is unlikely; document any reproducer before applying.

BEGIN;

DROP POLICY IF EXISTS deny_all ON public.investor_leads;
DROP POLICY IF EXISTS deny_all ON public.accounts;
DROP POLICY IF EXISTS deny_all ON public.account_logins;
DROP POLICY IF EXISTS deny_all ON public.trial_reminder_log;

DROP POLICY IF EXISTS deny_all ON public.merchant_analytics_events;
DROP POLICY IF EXISTS deny_all ON public.merchant_monthly_usage;
DROP POLICY IF EXISTS deny_all ON public.merchant_overage_invoices;
DROP POLICY IF EXISTS deny_all ON public.merchant_plan_limits;
DROP POLICY IF EXISTS deny_all ON public.plan_limits;
DROP POLICY IF EXISTS deny_all ON public.stream_sessions;
DROP POLICY IF EXISTS deny_all ON public.viewer_session_events;

ALTER TABLE public.investor_leads     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_logins     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_reminder_log DISABLE ROW LEVEL SECURITY;

COMMIT;
