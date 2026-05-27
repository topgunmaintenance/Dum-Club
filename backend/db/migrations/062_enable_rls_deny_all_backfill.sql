-- 062_enable_rls_deny_all_backfill.sql
-- Backfills RLS + deny_all policies on every public-schema table
-- that predates the RLS-by-default posture established by migration
-- 061. Extends 061's pattern from 11 tables to 32.
--
-- BACKGROUND
-- ----------
-- Migration 061 hardened the four ERROR-level tables flagged by
-- Supabase Advisor (accounts, account_logins, investor_leads,
-- trial_reminder_log) plus seven INFO-level tables that already had
-- RLS enabled but no policy. The 21 tables touched here all share
-- the same risk profile as 061's Group A: created before RLS-by-
-- default (migrations 003 to 042), still have RLS disabled, and
-- relied implicitly on FastAPI being the only writer.
--
-- The full audit is in docs/rls-deny-all-followup-audit.md.
--
-- WHY THIS IS SAFE TO APPLY
-- -------------------------
-- Same precondition as 061: every table here is accessed only via
-- the service_role key, either from FastAPI (backend/db/supabase.py)
-- or from Next.js API routes (frontend/lib/ai/supabase-service.ts).
-- Service role bypasses RLS, so backend reads and writes keep
-- working without code change.
--
-- Verified by:
--   grep -rn '\.from(["\047][a-z_]' frontend/ --include=*.ts \
--     --include=*.tsx | grep -v node_modules
-- Only two browser-side table .from() calls exist:
--   lib/linkWalletToProfile.ts → profiles  (already RLS-enabled, 001)
--   app/project/[id]/manage/layout.tsx → projects  (out of scope —
--     needs a positive read policy, not deny_all)
-- The two .from("offers") browser hits are supabase.storage.from()
-- against the Storage bucket of the same name, not the offers table.
--
-- INTENTIONAL EXCLUSIONS
-- ----------------------
-- offers (010) — excluded by operator request out of caution because
-- the Storage bucket shares the name with the public table. Audit
-- found zero browser table access on the table itself; if cleared,
-- a follow-up can deny_all it in a one-line migration.
-- projects — excluded; needs a positive owner-read policy, not
-- deny_all (SSR /manage layout reads it for the owner gate).
-- profiles, posts, categories, vaults, transcripts,
-- content_embeddings, ai_agent_* — already RLS-enabled upstream.
-- accounts, account_logins, investor_leads, trial_reminder_log,
-- stream_sessions, viewer_session_events, merchant_plan_limits,
-- merchant_monthly_usage, plan_limits, merchant_overage_invoices —
-- already covered by 061.
--
-- SPECIAL CASE: merchant_analytics_events
-- ---------------------------------------
-- Migration 061 created a deny_all policy on this table but never
-- ran ENABLE ROW LEVEL SECURITY on it (061's header described it
-- as "RLS enabled but no policy" — that was true for 6 of 7 tables
-- in 061's Group B, but merchant_analytics_events from 036 was the
-- one exception). The policy is currently inert. This migration
-- enables RLS on it (activating 061's policy) and re-asserts the
-- policy via DROP IF EXISTS + CREATE so the end state is identical
-- to every other table in this file.
--
-- ROLLBACK
-- --------
-- rollback/062_rollback.sql — drops every deny_all policy created
-- here and disables RLS on the 21 tables. Mirrors 061's rollback
-- shape.

BEGIN;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY on 21 tables.
-- ============================================================

ALTER TABLE public.service_profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dum_transactions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_businesses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_business_demand_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_proofs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_outreach_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_bids                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhook_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_leads                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_messages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_analytics_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seed_claim_audit                ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- deny_all policy on each of the 21 tables.
-- FOR ALL USING (false) blocks SELECT/INSERT/UPDATE/DELETE for
-- anon + authenticated. Service role still bypasses entirely.
--
-- DROP POLICY IF EXISTS keeps this migration re-runnable, including
-- against any state left over from 061 (which created a deny_all
-- on merchant_analytics_events).
-- ============================================================

DROP POLICY IF EXISTS deny_all ON public.service_profiles;
CREATE POLICY deny_all ON public.service_profiles                FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.availability_slots;
CREATE POLICY deny_all ON public.availability_slots              FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.bookings;
CREATE POLICY deny_all ON public.bookings                        FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.orders;
CREATE POLICY deny_all ON public.orders                          FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.business_profiles;
CREATE POLICY deny_all ON public.business_profiles               FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.dum_transactions;
CREATE POLICY deny_all ON public.dum_transactions                FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.favorites;
CREATE POLICY deny_all ON public.favorites                       FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.reviews;
CREATE POLICY deny_all ON public.reviews                         FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.referrals;
CREATE POLICY deny_all ON public.referrals                       FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.external_businesses;
CREATE POLICY deny_all ON public.external_businesses             FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.external_business_demand_events;
CREATE POLICY deny_all ON public.external_business_demand_events FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.purchase_proofs;
CREATE POLICY deny_all ON public.purchase_proofs                 FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchant_outreach_queue;
CREATE POLICY deny_all ON public.merchant_outreach_queue         FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.auctions;
CREATE POLICY deny_all ON public.auctions                        FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.auction_bids;
CREATE POLICY deny_all ON public.auction_bids                    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.processed_webhook_events;
CREATE POLICY deny_all ON public.processed_webhook_events        FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchants;
CREATE POLICY deny_all ON public.merchants                       FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.outreach_leads;
CREATE POLICY deny_all ON public.outreach_leads                  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.outreach_messages;
CREATE POLICY deny_all ON public.outreach_messages               FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchant_analytics_events;
CREATE POLICY deny_all ON public.merchant_analytics_events       FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.seed_claim_audit;
CREATE POLICY deny_all ON public.seed_claim_audit                FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ============================================================
-- Sanity check — assert all 21 tables now have RLS enabled.
-- RAISE EXCEPTION rolls the migration back if any assertion fails.
-- ============================================================
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO missing
  FROM (
    SELECT unnest(ARRAY[
      'service_profiles', 'availability_slots', 'bookings',
      'orders', 'business_profiles', 'dum_transactions',
      'favorites', 'reviews', 'referrals',
      'external_businesses', 'external_business_demand_events',
      'purchase_proofs', 'merchant_outreach_queue',
      'auctions', 'auction_bids', 'processed_webhook_events',
      'merchants', 'outreach_leads', 'outreach_messages',
      'merchant_analytics_events', 'seed_claim_audit'
    ]) AS t
  ) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = expected.t
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '062 assertion failed: RLS not enabled on: %', missing;
  END IF;
END $$;

COMMIT;
