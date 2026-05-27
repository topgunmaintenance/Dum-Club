-- 062_enable_rls_deny_all_backfill.sql
-- Codifies the existing production `deny_all` policy posture on 20
-- public-schema tables into tracked migration history, and normalizes
-- the policy role list from `{public}` to `{anon, authenticated}` for
-- consistency with migration 061's pattern.
--
-- THIS MIGRATION IS A NEAR-NO-OP. It does NOT introduce new protection
-- — every table touched here already has RLS enabled and a `deny_all`
-- policy in production today (verified via `pg_policies` against
-- project `snzodohibhxenqwdklxs` on 2026-05-27). What it DOES is:
--
--   1. Codify those policies into the migration record so future
--      state stays in sync with `backend/db/migrations/`. Today they
--      exist in prod but not in any tracked migration — likely
--      applied via the Supabase Studio dashboard between when
--      migration 061 shipped and today.
--
--   2. Re-assert ENABLE ROW LEVEL SECURITY (no-op on already-enabled
--      tables; defensive against future state where RLS could get
--      disabled).
--
--   3. Normalize the role list: existing prod policies target
--      `{public}` (PG pseudo-role); 061's pattern uses
--      `{anon, authenticated}`. Functionally equivalent for our use
--      case (service_role bypasses RLS regardless via BYPASSRLS), but
--      cosmetically consistent makes the intent clearer to readers.
--
-- BACKGROUND
-- ----------
-- The original audit (docs/rls-deny-all-followup-audit.md) inspected
-- migration files only and concluded these 20 tables had RLS disabled
-- with no policy — true historically, false in current production.
-- See PR #261 description for the full pre-state query results and
-- the drift discussion.
--
-- INTENTIONAL EXCLUSIONS (changed from PR's initial draft)
-- --------------------------------------------------------
-- `seed_claim_audit` — table does not exist in production at all
-- (migration `042_seed_claim_audit.sql` was never applied). Dropping
-- it from this migration; if/when 042 ships to prod, add a one-line
-- follow-up migration to lock down that table.
--
-- `offers` — operator carve-out. Already has RLS + `deny_all` plus
-- positive policies for public storefront reads. Untouched.
--
-- `projects`, `profiles` — browser/SSR exposed. Already have RLS +
-- positive policies for legitimate reads. Untouched.
--
-- TABLES IN SCOPE (20)
-- --------------------
-- 003: service_profiles, availability_slots, bookings
-- 010: orders
-- 014: business_profiles
-- 016: dum_transactions
-- 017: favorites, reviews, referrals
-- 018: external_businesses, external_business_demand_events,
--      purchase_proofs, merchant_outreach_queue
-- 022: auctions, auction_bids
-- 025: processed_webhook_events
-- 026: merchants
-- 028: outreach_leads, outreach_messages
-- 036: merchant_analytics_events (already at {anon, authenticated}
--      via 061 — re-asserts identical state)
--
-- KNOWN AT TIME OF MIGRATION (do not regress)
-- -------------------------------------------
-- Five tables (availability_slots, bookings, business_profiles,
-- service_profiles, orders) have OTHER positive permissive policies
-- in production that grant access (e.g. `Public read service profiles
-- USING (true)`). Permissive policies combine with OR, so `deny_all`
-- on those tables is currently cosmetic, not effective. This
-- migration deliberately does NOT touch those positive policies —
-- they exist intentionally for storefront / booking flows. Hardening
-- those is a separate audit; this PR only codifies the deny_all
-- policy state.
--
-- ROLLBACK
-- --------
-- rollback/062_rollback.sql — restores each policy to its pre-062
-- role list (`{public}` for the 19, `{anon, authenticated}` for
-- merchant_analytics_events which 061 already set that way). Does
-- NOT disable RLS, because RLS was already enabled before this
-- migration on every table touched — disabling it on rollback would
-- regress prod from a safer state to a less-safe one.

BEGIN;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY on all 20 tables.
-- All are already RLS-enabled in production; these are no-ops but
-- defend against any future state where RLS gets toggled off.
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

-- ============================================================
-- DROP + CREATE deny_all on each of the 20 tables.
-- Production has these targeting `{public}` (or `{anon, authenticated}`
-- for merchant_analytics_events from 061). This step normalizes all
-- 20 to `{anon, authenticated}` for consistency.
--
-- Semantically: USING (false) WITH CHECK (false) FOR ALL blocks
-- every operation. Targeting anon + authenticated is what we want
-- (service_role bypasses RLS via BYPASSRLS regardless of policy
-- role list).
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

-- ============================================================
-- Sanity check — assert all 20 tables have RLS enabled AND a
-- deny_all policy present. RAISE EXCEPTION rolls back the
-- migration if either assertion fails.
-- ============================================================
DO $$
DECLARE
  missing_rls text;
  missing_policy text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO missing_rls
  FROM (
    SELECT unnest(ARRAY[
      'service_profiles', 'availability_slots', 'bookings',
      'orders', 'business_profiles', 'dum_transactions',
      'favorites', 'reviews', 'referrals',
      'external_businesses', 'external_business_demand_events',
      'purchase_proofs', 'merchant_outreach_queue',
      'auctions', 'auction_bids', 'processed_webhook_events',
      'merchants', 'outreach_leads', 'outreach_messages',
      'merchant_analytics_events'
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

  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION '062 assertion failed: RLS not enabled on: %', missing_rls;
  END IF;

  SELECT string_agg(t, ', ' ORDER BY t) INTO missing_policy
  FROM (
    SELECT unnest(ARRAY[
      'service_profiles', 'availability_slots', 'bookings',
      'orders', 'business_profiles', 'dum_transactions',
      'favorites', 'reviews', 'referrals',
      'external_businesses', 'external_business_demand_events',
      'purchase_proofs', 'merchant_outreach_queue',
      'auctions', 'auction_bids', 'processed_webhook_events',
      'merchants', 'outreach_leads', 'outreach_messages',
      'merchant_analytics_events'
    ]) AS t
  ) expected
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = expected.t
      AND policyname = 'deny_all'
  );

  IF missing_policy IS NOT NULL THEN
    RAISE EXCEPTION '062 assertion failed: deny_all policy missing on: %', missing_policy;
  END IF;
END $$;

COMMIT;
