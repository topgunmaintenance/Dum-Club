-- 062_rollback.sql — reverses 062_enable_rls_deny_all_backfill.
--
-- Drops every deny_all policy created by 062 and disables RLS on
-- all 21 tables it touched.
--
-- Note: 061's original deny_all policy on merchant_analytics_events
-- is also dropped here. That policy was inert before 062 (RLS was
-- not enabled on that table until 062), so dropping it returns the
-- table to its pre-061 effective state.
--
-- WHEN TO USE
-- -----------
-- Run if 062 breaks an unexpected read path. Backend uses the
-- service_role key everywhere (which bypasses RLS), so breakage
-- is unlikely; document any reproducer before applying.

BEGIN;

DROP POLICY IF EXISTS deny_all ON public.service_profiles;
DROP POLICY IF EXISTS deny_all ON public.availability_slots;
DROP POLICY IF EXISTS deny_all ON public.bookings;
DROP POLICY IF EXISTS deny_all ON public.orders;
DROP POLICY IF EXISTS deny_all ON public.business_profiles;
DROP POLICY IF EXISTS deny_all ON public.dum_transactions;
DROP POLICY IF EXISTS deny_all ON public.favorites;
DROP POLICY IF EXISTS deny_all ON public.reviews;
DROP POLICY IF EXISTS deny_all ON public.referrals;
DROP POLICY IF EXISTS deny_all ON public.external_businesses;
DROP POLICY IF EXISTS deny_all ON public.external_business_demand_events;
DROP POLICY IF EXISTS deny_all ON public.purchase_proofs;
DROP POLICY IF EXISTS deny_all ON public.merchant_outreach_queue;
DROP POLICY IF EXISTS deny_all ON public.auctions;
DROP POLICY IF EXISTS deny_all ON public.auction_bids;
DROP POLICY IF EXISTS deny_all ON public.processed_webhook_events;
DROP POLICY IF EXISTS deny_all ON public.merchants;
DROP POLICY IF EXISTS deny_all ON public.outreach_leads;
DROP POLICY IF EXISTS deny_all ON public.outreach_messages;
DROP POLICY IF EXISTS deny_all ON public.merchant_analytics_events;
DROP POLICY IF EXISTS deny_all ON public.seed_claim_audit;

ALTER TABLE public.service_profiles                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_slots              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings                        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profiles               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.dum_transactions                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites                       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews                         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals                       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_businesses             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_business_demand_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_proofs                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_outreach_queue         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.auctions                        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_bids                    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhook_events        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchants                       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_leads                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_messages               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_analytics_events       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.seed_claim_audit                DISABLE ROW LEVEL SECURITY;

COMMIT;
