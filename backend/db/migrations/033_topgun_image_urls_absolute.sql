-- 033_topgun_image_urls_absolute.sql
-- Phase 0B follow-up to migration 031 — point Topgun storefront images
-- at the public originals on topgunmaintenance.com instead of the local
-- /images/topgun/ paths.
--
-- Context: migration 031 seeded offers + business_profiles with
-- /images/topgun/tg-*.jpeg paths that are supposed to be vendored by
-- scripts/fetch-topgun-photos.sh into frontend/public/images/topgun/
-- before deploy. In practice the fetch step has never run in CI, the
-- directory doesn't exist in the deployed build, and the storefront
-- shows 404s on every Topgun image. The images DO exist publicly at
-- https://topgunmaintenance.com/images/... — which is exactly what the
-- fetch script would have mirrored from. Pointing directly at the
-- source eliminates the 404s with zero asset vendoring.
--
-- This is intentionally NOT schema — only a data migration that
-- rewrites two tables' image-url columns. Safe to re-run. Idempotent
-- by construction (the UPDATE selectors are specific enough that a
-- second application is a no-op).
--
-- Long-term: if topgunmaintenance.com goes offline or the images move,
-- re-run scripts/fetch-topgun-photos.sh to vendor them locally and
-- write a follow-up migration that flips these URLs back to the
-- /images/topgun/ paths.

-- ── offers.primary_image_url ─────────────────────────────────────────
-- The 6 Topgun offer rows each reference a single tg-*.jpeg. Rewrite
-- each in place. `WHERE` clauses are title-scoped so we only touch
-- Topgun's offers, not any other merchant's.

UPDATE offers
SET primary_image_url = 'https://topgunmaintenance.com/images/TG-photo-jackingplane.jpeg'
WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance')
  AND primary_image_url = '/images/topgun/tg-jacking-plane.jpeg';

UPDATE offers
SET primary_image_url = 'https://topgunmaintenance.com/images/topgunpilotinplane.jpeg'
WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance')
  AND primary_image_url = '/images/topgun/tg-pilot-in-plane.jpeg';

UPDATE offers
SET primary_image_url = 'https://topgunmaintenance.com/images/drone-pilots.jpeg'
WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance')
  AND primary_image_url = '/images/topgun/tg-drone-pilots.jpeg';

UPDATE offers
SET primary_image_url = 'https://topgunmaintenance.com/images/wing-inspection.jpeg'
WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance')
  AND primary_image_url = '/images/topgun/tg-wing-inspection.jpeg';

UPDATE offers
SET primary_image_url = 'https://topgunmaintenance.com/images/full-airplane-hanger.jpeg'
WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance')
  AND primary_image_url = '/images/topgun/tg-hangar.jpeg';

-- ── business_profiles.logo_url ───────────────────────────────────────
-- The Topgun business profile's logo uses tg-pilot-in-plane.jpeg per
-- migration 031 line 118. Same rewrite pattern.

UPDATE business_profiles
SET logo_url = 'https://topgunmaintenance.com/images/topgunpilotinplane.jpeg'
WHERE business_name = 'Topgun Maintenance LLC'
  AND logo_url = '/images/topgun/tg-pilot-in-plane.jpeg';

-- ── projects.ai_output photos array ──────────────────────────────────
-- The project row's ai_output JSON includes a photos array with the
-- same 5 local paths. This field isn't rendered by the storefront
-- today (no frontend consumer references it), but rewrite it too so
-- the whole row is internally consistent. If a future UI surfaces
-- ai_output.photos it won't re-introduce 404s.

UPDATE projects
SET ai_output = jsonb_set(
    ai_output,
    '{photos}',
    jsonb_build_array(
      'https://topgunmaintenance.com/images/TG-photo-jackingplane.jpeg',
      'https://topgunmaintenance.com/images/topgunpilotinplane.jpeg',
      'https://topgunmaintenance.com/images/drone-pilots.jpeg',
      'https://topgunmaintenance.com/images/wing-inspection.jpeg',
      'https://topgunmaintenance.com/images/full-airplane-hanger.jpeg'
    )
  )
WHERE slug = 'topgun-maintenance'
  AND ai_output ? 'photos';

-- ── Sanity check (surfaces to migration log) ────────────────────────

DO $$
DECLARE
  off_count INTEGER;
  bp_count INTEGER;
  proj_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO off_count FROM offers
    WHERE project_id = (SELECT id FROM projects WHERE slug = 'topgun-maintenance')
      AND primary_image_url LIKE 'https://topgunmaintenance.com/%';

  SELECT COUNT(*) INTO bp_count FROM business_profiles
    WHERE business_name = 'Topgun Maintenance LLC'
      AND logo_url LIKE 'https://topgunmaintenance.com/%';

  SELECT COUNT(*) INTO proj_count FROM projects
    WHERE slug = 'topgun-maintenance'
      AND ai_output->'photos'->>0 LIKE 'https://topgunmaintenance.com/%';

  IF off_count <> 6 THEN
    RAISE WARNING 'topgun image rewrite: expected 6 offers updated, got %', off_count;
  END IF;
  IF bp_count <> 1 THEN
    RAISE WARNING 'topgun image rewrite: expected 1 business_profile updated, got %', bp_count;
  END IF;
  IF proj_count <> 1 THEN
    RAISE WARNING 'topgun image rewrite: expected 1 project ai_output updated, got %', proj_count;
  END IF;

  RAISE NOTICE 'topgun image rewrite complete: offers=%, business_profiles=%, projects=%',
    off_count, bp_count, proj_count;
END $$;
