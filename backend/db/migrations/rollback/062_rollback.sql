-- 062_rollback.sql — restores the pre-062 deny_all policy state on
-- the 20 tables touched by 062.
--
-- IMPORTANT: this rollback does NOT disable RLS. Every table touched
-- by 062 already had RLS enabled BEFORE 062 ran (the migration was a
-- drift-codification, not new protection). Disabling RLS here would
-- regress production to a less-safe state than what existed
-- pre-migration.
--
-- What this DOES restore: the pre-062 policy role list. 062
-- normalized all 20 deny_all policies to `{anon, authenticated}`;
-- this rollback restores the original `{public}` role list for the
-- 19 tables that had it (i.e. every table except
-- merchant_analytics_events), and re-asserts
-- `{anon, authenticated}` on merchant_analytics_events (which 061
-- had already set that way).
--
-- WHEN TO USE
-- -----------
-- Run only if the role-list normalization causes an unexpected
-- regression. The semantic behavior of `{public}` vs
-- `{anon, authenticated}` is identical for our access model (service_role
-- bypasses RLS via BYPASSRLS regardless), so regression is unlikely;
-- document any reproducer before applying.

BEGIN;

-- Restore {public} role list on the 19 tables that had it pre-062.
DROP POLICY IF EXISTS deny_all ON public.service_profiles;
CREATE POLICY deny_all ON public.service_profiles                FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.availability_slots;
CREATE POLICY deny_all ON public.availability_slots              FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.bookings;
CREATE POLICY deny_all ON public.bookings                        FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.orders;
CREATE POLICY deny_all ON public.orders                          FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.business_profiles;
CREATE POLICY deny_all ON public.business_profiles               FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.dum_transactions;
CREATE POLICY deny_all ON public.dum_transactions                FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.favorites;
CREATE POLICY deny_all ON public.favorites                       FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.reviews;
CREATE POLICY deny_all ON public.reviews                         FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.referrals;
CREATE POLICY deny_all ON public.referrals                       FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.external_businesses;
CREATE POLICY deny_all ON public.external_businesses             FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.external_business_demand_events;
CREATE POLICY deny_all ON public.external_business_demand_events FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.purchase_proofs;
CREATE POLICY deny_all ON public.purchase_proofs                 FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchant_outreach_queue;
CREATE POLICY deny_all ON public.merchant_outreach_queue         FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.auctions;
CREATE POLICY deny_all ON public.auctions                        FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.auction_bids;
CREATE POLICY deny_all ON public.auction_bids                    FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.processed_webhook_events;
CREATE POLICY deny_all ON public.processed_webhook_events        FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.merchants;
CREATE POLICY deny_all ON public.merchants                       FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.outreach_leads;
CREATE POLICY deny_all ON public.outreach_leads                  FOR ALL TO public USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deny_all ON public.outreach_messages;
CREATE POLICY deny_all ON public.outreach_messages               FOR ALL TO public USING (false) WITH CHECK (false);

-- merchant_analytics_events had {anon, authenticated} pre-062 (set
-- by migration 061). Restore that exact role list.
DROP POLICY IF EXISTS deny_all ON public.merchant_analytics_events;
CREATE POLICY deny_all ON public.merchant_analytics_events       FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

COMMIT;
