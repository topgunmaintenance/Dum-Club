-- 087_live_replays.sql
-- replay-recording-infra (2026-07-06): one replay per project.
--
-- Stores the latest recorded live show for a project plus the
-- merchant's "loop my last show while I'm offline" opt-in. The
-- enabled flag doubles as the recording opt-in: a merchant flips it
-- BEFORE any recording exists, and the next go-live records the host.
-- One row per project (UNIQUE) is the cost cap's DB half — the S3
-- half deletes the previous prefix when a new recording lands.

CREATE TABLE IF NOT EXISTS live_replays (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  -- Merchant opt-in: record my shows + loop the latest one when offline.
  enabled          boolean NOT NULL DEFAULT false,
  -- Latest recording (NULL until the first recorded show ends).
  playback_url     text,
  s3_prefix        text,
  duration_seconds integer,
  recorded_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_replays_project ON live_replays(project_id);
