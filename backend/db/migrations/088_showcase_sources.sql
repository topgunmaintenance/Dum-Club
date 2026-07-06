-- 088_showcase_sources.sql
-- showcase-upload (2026-07-06): live_replays learns a second source.
--
-- 'live_recording' rows come from the end-stage finalizer (087);
-- 'upload' rows come from the merchant's "Record or upload a
-- showcase" flow. At most one row per (project, source), and at most
-- one ACTIVE row per project — is_active is the merchant's "this one
-- plays on my shop" pick (founder decision 2026-07-06).

ALTER TABLE live_replays
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_recording';

ALTER TABLE live_replays
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT false;

ALTER TABLE live_replays
  DROP CONSTRAINT IF EXISTS live_replays_source_check;
ALTER TABLE live_replays
  ADD CONSTRAINT live_replays_source_check
  CHECK (source IN ('live_recording', 'upload'));

-- One row per (project, source) replaces the old one-row-per-project.
ALTER TABLE live_replays
  DROP CONSTRAINT IF EXISTS live_replays_project_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_replays_project_source
  ON live_replays(project_id, source);

-- Exactly one active video per project.
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_replays_project_active
  ON live_replays(project_id) WHERE is_active;

-- Backfill: an enabled replay was implicitly "the one that plays".
UPDATE live_replays SET is_active = true
  WHERE enabled = true AND is_active = false;
