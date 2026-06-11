-- Migration 079: storefront location on business_profiles
--
-- ⚠️  DRAFT — NOT APPLIED. Authored for review only. Do NOT run this
--     against any database until approved.
--
-- WHY
-- ---
-- The discover "Near me" / city filter needs per-storefront location.
-- Today business_profiles (migration 014) has NO geo columns, and projects
-- has none either. merchants has only location_city / location_state (text,
-- no coordinates). The geo-complete precedent is external_businesses
-- (migration 018): city / postal_code / latitude / longitude.
--
-- NAMING RECONCILIATION (do not introduce a 4th style)
-- ----------------------------------------------------
-- We deliberately mirror external_businesses (018) verbatim:
--     city          TEXT
--     postal_code   TEXT
--     latitude      DOUBLE PRECISION
--     longitude     DOUBLE PRECISION
-- plus the same lower(city) index. We do NOT use the merchants
-- `location_city` prefix style here — coordinates are new and the
-- external_businesses geo columns are the established lat/lng convention,
-- so the on-platform and off-platform location shapes stay identical.
--
-- RLS
-- ---
-- business_profiles already has RLS enabled + a deny_all policy (migration
-- 062). Adding columns does not change RLS; all reads stay service-role
-- mediated through the discover/storefront endpoints. No policy change here.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE public.business_profiles
    ADD COLUMN IF NOT EXISTS city         TEXT,
    ADD COLUMN IF NOT EXISTS postal_code  TEXT,
    ADD COLUMN IF NOT EXISTS latitude     DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude    DOUBLE PRECISION;

-- Case-insensitive city lookups for the discover city filter.
CREATE INDEX IF NOT EXISTS idx_business_profiles_city
    ON public.business_profiles (lower(city));

COMMENT ON COLUMN public.business_profiles.latitude IS
  'Storefront latitude (WGS84) for discover Near-me distance filtering. '
  'NULL until the merchant sets a location; the frontend degrades gracefully.';
COMMENT ON COLUMN public.business_profiles.longitude IS
  'Storefront longitude (WGS84). NULL until set.';
