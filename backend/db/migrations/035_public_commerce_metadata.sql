-- Phase 1: foundation columns for public APIs, Schema.org JSON-LD,
-- and AI-discoverable merchant metadata.
--
-- All new columns are NULLABLE. No data is migrated, no rows are
-- backfilled. Existing merchants continue to work unchanged; new
-- metadata appears as merchants supply it (or as future onboarding
-- flows populate it).
--
-- This migration is forward-only by repository convention (all
-- prior migrations 027-034 follow the same pattern — no down
-- section). The PR description records the manual revert sequence.
--
-- Run in Supabase SQL Editor.

-- ── categories: canonical taxonomy ──────────────────────────────
--
-- Twelve top-level categories cover the local-business universe.
-- Sub-categories live in the same table via parent_id (NULL for
-- top-level). Every row carries schema_org_type so the JSON-LD
-- generator can map a DUM category to the closest Schema.org @type
-- (Restaurant, AutoRepair, BeautySalon, etc) without a frontend
-- lookup table.

CREATE TABLE IF NOT EXISTS categories (
    id              TEXT PRIMARY KEY,
    parent_id       TEXT REFERENCES categories(id),
    name            TEXT NOT NULL,
    description     TEXT,
    schema_org_type TEXT,
    display_order   INT  NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the twelve top-level categories. Idempotent via ON CONFLICT
-- so repeated runs of this migration are safe. Sub-categories are
-- intentionally left to be added on demand as real merchants need
-- them — seeding hundreds of unused categories creates noise.

INSERT INTO categories (id, name, schema_org_type, display_order) VALUES
    ('restaurants',           'Restaurants',           'Restaurant',                   10),
    ('food-trucks',           'Food Trucks',           'FoodEstablishment',            20),
    ('coffee-shops',          'Coffee Shops',          'CafeOrCoffeeShop',             30),
    ('bars',                  'Bars',                  'BarOrPub',                     40),
    ('auto-services',         'Auto Services',         'AutoRepair',                   50),
    ('home-services',         'Home Services',         'HomeAndConstructionBusiness',  60),
    ('beauty-services',       'Beauty Services',       'BeautySalon',                  70),
    ('fitness',               'Fitness',               'ExerciseGym',                  80),
    ('retail',                'Retail',                'Store',                        90),
    ('art-handcraft',         'Art & Handcraft',       'Store',                       100),
    ('events',                'Events',                'EventVenue',                  110),
    ('professional-services', 'Professional Services', 'ProfessionalService',         120)
ON CONFLICT (id) DO NOTHING;

-- Public-read RLS for the categories reference table. Without this,
-- Supabase's anon and authenticated roles can't see any rows via the
-- REST API (default-deny when RLS is enabled). The DO block makes the
-- policy creation idempotent — Postgres lacks CREATE POLICY IF NOT
-- EXISTS until 16, and 034 was applied to a 15.x cluster.

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY categories_public_read
        ON categories
        FOR SELECT
        USING (true);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;


-- ── projects: business metadata for public listing + Schema.org ──
--
-- Every column nullable. A merchant who hasn't supplied location,
-- hours, or category continues to render exactly as before — JSON-LD
-- builders already drop missing fields, and the future public API
-- will return null for unsupplied keys.
--
-- slug_canonical is forward-looking: when/if a merchant renames
-- their slug, the old slug stays here as the redirect target. Not
-- used yet; column reserved.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug_canonical    TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category_id       TEXT REFERENCES categories(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_lat      DOUBLE PRECISION;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_lng      DOUBLE PRECISION;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_city     TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_region   TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_country  TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS service_area      TEXT[];
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hours_weekly      JSONB;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hours_tz          TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_phone     TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS contact_website   TEXT;


-- ── offers: slug, category, tags, deal window ───────────────────
--
-- offer.slug pairs with the existing per-project addressing. Once
-- populated, public URLs for an offer can be /businesses/<slug>/
-- offers/<offer-slug> instead of /offers/<uuid> — matters for SEO
-- and AI-readable canonical paths.
--
-- tags is an open-ended secondary taxonomy. Schema.org Offer doesn't
-- have a canonical "tags" field, but tags map cleanly onto Product
-- additionalProperty[] when the JSON-LD generator catches up. Today,
-- tags are useful for internal filtering and future search.
--
-- deal_starts_at / deal_ends_at / deal_percent_off are the flash-sale
-- primitives. A non-null deal_ends_at in the future means a deal is
-- live; the UI / public API will compute "active deal" from these.

ALTER TABLE offers ADD COLUMN IF NOT EXISTS slug              TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS category_id       TEXT REFERENCES categories(id);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS tags              TEXT[] DEFAULT '{}';
ALTER TABLE offers ADD COLUMN IF NOT EXISTS deal_starts_at    TIMESTAMPTZ;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS deal_ends_at      TIMESTAMPTZ;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS deal_percent_off  NUMERIC(5,2);
ALTER TABLE offers ADD COLUMN IF NOT EXISTS deal_label        TEXT;


-- ── indexes ─────────────────────────────────────────────────────
--
-- All partial indexes (WHERE ... IS NOT NULL) so that pre-migration
-- rows don't bloat the indexes. Index size grows only as merchants
-- supply the new metadata.

-- Slug uniqueness scoped per project. Two projects can each have an
-- offer slugged "annual-inspection"; the same project cannot.
CREATE UNIQUE INDEX IF NOT EXISTS offers_project_slug_unique
    ON offers (project_id, slug)
    WHERE slug IS NOT NULL;

-- Geo lookups via bounding-box query (no PostGIS dependency).
-- Sufficient for the first several thousand merchants. Migrate to a
-- PostGIS GIST index when the read volume justifies it.
CREATE INDEX IF NOT EXISTS projects_location_idx
    ON projects (location_lat, location_lng)
    WHERE location_lat IS NOT NULL;

-- Category filter on projects + offers (both sides).
CREATE INDEX IF NOT EXISTS projects_category_idx
    ON projects (category_id)
    WHERE category_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS offers_category_idx
    ON offers (category_id)
    WHERE category_id IS NOT NULL;

-- Active-deal lookups. Index only rows with a deal window set,
-- ordered by deal_ends_at so "deals ending soon" queries are
-- already-sorted scans. Skips the dominant case (most offers have
-- no deal) and stays small.
CREATE INDEX IF NOT EXISTS offers_active_deal_idx
    ON offers (deal_ends_at)
    WHERE deal_ends_at IS NOT NULL;

-- Tag containment search. Supports `tags @> '{flash-sale}'` and
-- multi-tag intersection queries. Partial so empty arrays don't
-- bloat the index.
CREATE INDEX IF NOT EXISTS offers_tags_gin
    ON offers USING GIN (tags)
    WHERE tags IS NOT NULL AND array_length(tags, 1) > 0;
