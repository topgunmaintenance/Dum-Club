-- 031_topgun_storefront_seed.sql
-- Phase 0B Task 3 — Topgun Maintenance LLC founding merchant storefront.
--
-- Goal: seed the first real verified merchant so /discover shows 1 verified
-- business (not 0) and the public route /project/topgun-maintenance renders
-- a full storefront ready to receive its first real Stripe transaction.
--
-- Full spec: CLAUDE.md v5.0 Section 7.
--
-- This migration is IDEMPOTENT — safe to run multiple times. Re-running
-- will not create duplicate rows and will not reset any data that's been
-- updated since the initial seed (we use ON CONFLICT DO NOTHING on the
-- seed inserts and only touch columns we own).
--
-- Runs AFTER the photo mirror script:
--   bash scripts/fetch-topgun-photos.sh
-- The 5 photos must exist at /images/topgun/tg-*.jpeg before deploying
-- or the storefront image tags will 404.
--
-- Reversibility: to remove the Topgun seed, run:
--   DELETE FROM offers WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance');
--   DELETE FROM projects WHERE slug = 'topgun-maintenance';
--   DELETE FROM business_profiles WHERE owner_privy_id = 'seed:topgun-maintenance';
-- The added columns (slug, sort_order, verified, is_verified, profile_strength)
-- are left in place since they're the basis for the v5.0 listing model.

-- ── 1. Columns ────────────────────────────────────────────────────────────

-- slug: human-readable URL segment for storefronts. NULL for legacy
-- AI-generated projects (they continue to resolve by UUID). New founding
-- merchant storefronts get a slug. Resolved by GET /api/projects/{key}
-- with a UUID-first / slug-fallback lookup (see projects.py).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS slug VARCHAR;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug_unique
  ON projects(slug)
  WHERE slug IS NOT NULL;

COMMENT ON COLUMN projects.slug IS
  'Optional human-readable URL segment. NULL for legacy AI projects (they resolve by UUID). Founding merchant storefronts get a slug like ''topgun-maintenance''. Enforced unique when non-null via idx_projects_slug_unique.';

-- sort_order: pin-first ordering on /discover. NULL for organic projects
-- (they sort by created_at / volume). A non-null value floats the project
-- to the top of every tab, ordered ascending (0 = highest priority). Used
-- during Phase 0B to pin the first founding merchant above AI projects.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

COMMENT ON COLUMN projects.sort_order IS
  'Discover pin-first ordering. NULL = organic sort. Non-null = pinned, ordered ascending (0 = first). Respected by /discover sortedProjects().';

-- verified / is_verified / profile_strength: explicit per-project quality
-- flags for Phase 0B. These overlap conceptually with merchants.trust_level
-- and business_profiles.verification_status (which remain the long-term
-- source of truth for the merchant), but they give the public project
-- listing a cheap-to-query signal without joining two extra tables every
-- request. Phase 2 may collapse these back into the join once the number
-- of merchants makes indexed columns on projects worth it.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS profile_strength INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_profile_strength_range;
ALTER TABLE projects
  ADD CONSTRAINT projects_profile_strength_range
  CHECK (profile_strength BETWEEN 0 AND 100);

COMMENT ON COLUMN projects.verified IS
  'Phase 0B quality flag. TRUE = storefront has been manually reviewed and meets the verified bar. Kept in sync with business_profiles.verification_status=''verified'' for the linked profile. Read by /discover owner_verified fallback.';

COMMENT ON COLUMN projects.is_verified IS
  'Alias of projects.verified retained for API consumer consistency. Always mirrors verified.';

COMMENT ON COLUMN projects.profile_strength IS
  'Storefront completeness score 0-100. 100 = bio + photos + contact + >=1 offer + verified. Used by /discover ranking.';

-- Partial index — verified projects are the hot path for /discover pinning.
CREATE INDEX IF NOT EXISTS idx_projects_verified
  ON projects(verified)
  WHERE verified = TRUE;

-- Partial index for the sort_order lookup on /discover.
CREATE INDEX IF NOT EXISTS idx_projects_sort_order
  ON projects(sort_order)
  WHERE sort_order IS NOT NULL;

-- ── 2. Business profile row ───────────────────────────────────────────────

-- owner_privy_id is a seed sentinel (seed:topgun-maintenance) so Julian can
-- claim the row later by UPDATE-ing it to his real Privy DID after he signs
-- in for the first time. Until then, the row is not owned by any real user
-- account but is still visible to the public listing via the verification
-- join in /api/projects/public.
INSERT INTO business_profiles (
  owner_privy_id,
  business_name,
  category,
  short_description,
  logo_url,
  website,
  contact_email,
  verification_status,
  verification_note,
  created_at,
  updated_at
) VALUES (
  'seed:topgun-maintenance',
  'Topgun Maintenance LLC',
  'Aircraft Maintenance',
  'FAA-certified aircraft maintenance and inspection. Serving NY, NJ, PA, CT, DE from Morristown Municipal (MMU).',
  '/images/topgun/tg-pilot-in-plane.jpeg',
  'https://topgunmaintenance.com',
  'julian@topgunmaintenance.com',
  'verified',
  'Phase 0B founding merchant #1. Verified by Julian Mero, owner.',
  NOW(),
  NOW()
)
ON CONFLICT (owner_privy_id) DO NOTHING;

-- ── 3. Project row (the storefront) ───────────────────────────────────────

-- The storefront lives in the projects table (matches existing
-- /project/[key] routing). Token fields are set to the same pattern a
-- simulated-token project uses so the page renders without the token UI
-- flashing as "pending" — but token_status='inactive' to make clear this
-- is a services storefront, not an AI business with a live token.
INSERT INTO projects (
  name,
  title,
  description,
  category,
  template_type,
  status,
  review_status,
  visibility,
  is_deleted,
  slug,
  sort_order,
  verified,
  is_verified,
  profile_strength,
  privy_id,
  business_profile_id,
  token_name,
  token_symbol,
  token_supply,
  token_decimals,
  token_utility,
  token_status,
  token_mint_address,
  token_created_at,
  promo_copy,
  store_items,
  ai_output,
  created_at
)
SELECT
  'Topgun Maintenance LLC',
  'Topgun Maintenance LLC',
  E'FAA-certified aircraft maintenance, inspection, and AOG response — ' ||
  E'based at Morristown Municipal (MMU), serving NY, NJ, PA, CT, DE.\n\n' ||
  E'Annual inspections (FAR 91), 100-hour inspections, drone inspections ' ||
  E'(Part 107), avionics troubleshooting, pre/post flight checks, and 24/7 ' ||
  E'AOG emergency response. Owner-operated by Julian Mero. Fast quotes, ' ||
  E'honest work, all documentation provided.',
  'service',
  'local_service',
  'live',
  'approved',
  'public',
  FALSE,
  'topgun-maintenance',
  0,
  TRUE,
  TRUE,
  100,
  'seed:topgun-maintenance',
  bp.id,
  'Topgun Maintenance',
  'TOPGUN',
  0,
  0,
  'Services storefront — no token',
  'inactive',
  NULL,
  NULL,
  E'Aircraft maintenance you can trust. Based at MMU, serving the tri-state. ' ||
  E'Annual, 100-hour, and drone inspections. 24/7 AOG response. ' ||
  E'Founding merchant on DUM Club — flat fee, 0% commission.',
  '[]'::jsonb,
  jsonb_build_object(
    'seed_source', 'migration_031',
    'founding_slot', 1,
    'photos', jsonb_build_array(
      '/images/topgun/tg-jacking-plane.jpeg',
      '/images/topgun/tg-pilot-in-plane.jpeg',
      '/images/topgun/tg-drone-pilots.jpeg',
      '/images/topgun/tg-wing-inspection.jpeg',
      '/images/topgun/tg-hangar.jpeg'
    ),
    'contact', jsonb_build_object(
      'email', 'julian@topgunmaintenance.com',
      'phone', '+1 (201) 452-1986',
      'location', 'Morristown, NJ (MMU)',
      'service_area', 'NY, NJ, PA, CT, DE'
    )
  ),
  NOW()
FROM business_profiles bp
WHERE bp.owner_privy_id = 'seed:topgun-maintenance'
ON CONFLICT DO NOTHING;

-- Backfill: if a prior partial run created the project without the
-- business_profile_id (possible if the two inserts ran in different
-- transactions), re-link it now.
UPDATE projects
SET business_profile_id = (
  SELECT id FROM business_profiles WHERE owner_privy_id = 'seed:topgun-maintenance' LIMIT 1
)
WHERE slug = 'topgun-maintenance'
  AND business_profile_id IS NULL;

-- ── 4. Offers — 6 services ────────────────────────────────────────────────

-- Each offer row is priced with price_usd = the "from $X" anchor. Avionics
-- troubleshooting is $150/hr (1-hour minimum). Real quotes happen over
-- email/phone; the storefront price is an anchor for the Stripe checkout
-- deposit flow once wired up. unlimited_inventory=TRUE so no stock counter.
WITH p AS (
  SELECT id FROM projects WHERE slug = 'topgun-maintenance' LIMIT 1
)
INSERT INTO offers (
  project_id,
  title,
  description,
  price_usd,
  offer_type,
  delivery_info,
  primary_image_url,
  is_active,
  unlimited_inventory,
  quantity_sold,
  token_discount_percent,
  created_at
)
SELECT p.id, v.title, v.description, v.price_usd, v.offer_type,
       v.delivery_info, v.primary_image_url, TRUE, TRUE, 0, 0, NOW()
FROM p,
(VALUES
  (
    'Annual Inspection (FAR 91)',
    E'FAR Part 91 annual inspection. Comprehensive airworthiness check ' ||
    E'per 14 CFR 43 Appendix D. Full logbook signoff, discrepancy ' ||
    E'report, and return-to-service documentation included.',
    850.00,
    'physical_product',
    'Performed at MMU. Schedule by phone or email. Typical turnaround 2-5 days.',
    '/images/topgun/tg-jacking-plane.jpeg'
  ),
  (
    '100-Hour Inspection',
    E'100-hour inspection for commercial-use aircraft. Same scope as ' ||
    E'annual under Part 91. Fast turnaround to minimize downtime for ' ||
    E'flight schools and rental ops.',
    650.00,
    'physical_product',
    'Performed at MMU. Drop-off or fly-in. Typical turnaround 1-3 days.',
    '/images/topgun/tg-wing-inspection.jpeg'
  ),
  (
    'Drone Inspection (Part 107)',
    E'Part 107 commercial drone airworthiness inspection. Battery, ' ||
    E'airframe, flight controller, and propulsion systems checked. ' ||
    E'Documentation for operator compliance included.',
    350.00,
    'physical_product',
    'Performed at MMU or on-site by appointment. Typical turnaround same day.',
    '/images/topgun/tg-drone-pilots.jpeg'
  ),
  (
    'AOG Emergency Response',
    E'Aircraft-on-ground emergency response. 24/7 dispatch within the ' ||
    E'tri-state area (NY, NJ, PA, CT, DE). Diagnosis and temporary ' ||
    E'repair to return aircraft to service. Travel billed separately.',
    500.00,
    'physical_product',
    '24/7 phone dispatch. Onsite typically within 4 hours for MMU/TEB/EWR area.',
    '/images/topgun/tg-pilot-in-plane.jpeg'
  ),
  (
    'Avionics Troubleshooting',
    E'Hourly avionics troubleshooting and repair. Garmin, Avidyne, ' ||
    E'Bendix/King, and legacy systems. 1-hour minimum, billed in ' ||
    E'15-minute increments after that.',
    150.00,
    'physical_product',
    'Performed at MMU. Bring your squawk list — we will work the list by priority.',
    '/images/topgun/tg-hangar.jpeg'
  ),
  (
    'Pre/Post Flight Check',
    E'Pre-flight or post-flight inspection by an FAA-certified A&P. ' ||
    E'Good for renters, new owners, and pilots who want a second set ' ||
    E'of eyes before a long cross-country.',
    200.00,
    'physical_product',
    'Performed at MMU. Schedule 24 hours in advance.',
    '/images/topgun/tg-jacking-plane.jpeg'
  )
) AS v(title, description, price_usd, offer_type, delivery_info, primary_image_url)
WHERE NOT EXISTS (
  SELECT 1 FROM offers o2 WHERE o2.project_id = p.id AND o2.title = v.title
);

-- ── 5. Sanity checks (surface errors in the migration log) ───────────────

DO $$
DECLARE
  bp_count INTEGER;
  proj_count INTEGER;
  offer_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bp_count FROM business_profiles WHERE owner_privy_id = 'seed:topgun-maintenance';
  SELECT COUNT(*) INTO proj_count FROM projects WHERE slug = 'topgun-maintenance';
  SELECT COUNT(*) INTO offer_count FROM offers WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance');

  IF bp_count <> 1 THEN
    RAISE WARNING 'topgun seed: expected 1 business_profile row, got %', bp_count;
  END IF;
  IF proj_count <> 1 THEN
    RAISE WARNING 'topgun seed: expected 1 project row, got %', proj_count;
  END IF;
  IF offer_count <> 6 THEN
    RAISE WARNING 'topgun seed: expected 6 offer rows, got %', offer_count;
  END IF;

  RAISE NOTICE 'topgun seed complete: business_profiles=%, projects=%, offers=%',
    bp_count, proj_count, offer_count;
END $$;
