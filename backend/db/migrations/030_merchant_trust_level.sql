-- 030_merchant_trust_level.sql
-- Two-tier merchant trust system with forward compatibility.
--
-- Adds a `trust_level` column to merchants so the public verified
-- count is a real, defensible number computed against a clear rule
-- — and so we can raise the bar later without a data migration.
--
-- Tier definitions (Master Playbook):
--
--   'unverified' (default)
--     Anything that doesn't meet the Verified bar. Phase 0 default
--     for any newly-created merchant.
--
--   'verified' (Phase 0 / Phase 1 bar)
--     Stripe Connect active (stripe_connect_status='connected')
--     AND business_profile_id is non-null and points to a profile
--     with at least one uploaded photo
--     AND at least one published offer with a real price (>0)
--     attached to the merchant's project.
--
--   'trusted' (Phase 2C bar — future)
--     Verified plus:
--       - Stripe KYC complete (verified ID document)
--       - Business registration confirmed (LLC / DBA / sole prop)
--       - Physical address verified (postcard or Google Street View)
--       - At least 5 real customer reviews tied to paid Stripe
--         transactions on this merchant's project
--
-- The 'trusted' tier is defined NOW so we don't have to migrate
-- data later when we raise the bar in Phase 2C. The Phase 0 backfill
-- only sets 'verified' on rows that meet the verified rule; nothing
-- gets set to 'trusted' until Phase 2C ships.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS trust_level VARCHAR NOT NULL DEFAULT 'unverified';

COMMENT ON COLUMN merchants.trust_level IS
  'Merchant trust tier: unverified | verified | trusted. Verified = Stripe Connect active + business_profile with >=1 photo + >=1 published offer with price>0 (Phase 0/1 bar). Trusted = Verified + Stripe KYC + biz registration + address verified + >=5 reviews (Phase 2C, not yet enforced). Updated by the periodic recompute in projects.py live-stats; not maintained inline by signup.';

-- Lookup index for the verified-count query in /api/projects/live-stats.
-- Partial — most rows are 'unverified', the count we care about is the
-- non-unverified ones.
CREATE INDEX IF NOT EXISTS idx_merchants_trust_level
  ON merchants(trust_level)
  WHERE trust_level != 'unverified';

-- Backfill is intentionally not included in this migration. The verified
-- count is computed live in /api/projects/live-stats by joining merchants,
-- business_profiles, projects, and offers. Once Topgun (the Phase 0 pilot)
-- meets the verified rule, the count returns 1 without any manual SQL.
-- See backend/api/routes/projects.py:live_stats() for the join logic.
