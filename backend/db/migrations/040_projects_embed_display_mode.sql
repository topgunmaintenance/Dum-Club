-- 040_projects_embed_display_mode.sql
-- Outer embed display mode (Bubble / Full / Automatic).
--
-- Controls how DUM Club appears on the merchant's own website when
-- they paste the embed script. Distinct from popin_config.mode
-- (the floating greeting bubble inside the iframe).
--
--   bubble     small floating launcher on the merchant's site that
--              opens the full DUM storefront in an overlay on click
--   full       inline iframe of the full storefront (current default
--              behaviour today)
--   automatic  picks bubble vs full based on live state. Default for
--              new merchants. While the project is not live we render
--              full (current behavior); when live, the bubble grabs
--              attention. Recommended.
--
-- A plain text column with a CHECK constraint keeps the validation
-- close to the data. The frontend dashboard writes via PATCH
-- /api/projects/{id} (ProjectUpdate model accepts the field) and the
-- embed reads it alongside the existing project payload.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS embed_display_mode TEXT NOT NULL DEFAULT 'automatic';

ALTER TABLE projects
  ADD CONSTRAINT projects_embed_display_mode_check
  CHECK (embed_display_mode IN ('bubble', 'full', 'automatic'));

COMMENT ON COLUMN projects.embed_display_mode IS
  'How DUM Club appears on the merchant''s own website. One of
   bubble (floating launcher) / full (inline iframe) / automatic
   (chooses based on live state). Default automatic. Distinct from
   popin_config.mode (the inner greeting bubble).';
