-- 047_replay_url.sql
-- Replay foundation: a single nullable column on projects for the
-- post-stream replay URL. The scaffold is intentionally minimal —
-- columns and a display path, no recording pipeline.
--
-- How the URL gets populated (planned, not yet wired):
--   * AWS IVS Real-Time supports AutoParticipantRecordingConfiguration
--     -> S3. When IVS activation goes through (see docs/IVS_ACTIVATION.md)
--     and recording is enabled, an end-of-session handler can write the
--     S3 (or CDN-fronted) URL back into projects.replay_url.
--   * Until then the column can be set manually from the existing
--     admin surface, or remain NULL — which is the no-replay default
--     the UI already handles.
--
-- Additive change, all rows pre-existing get NULL implicitly.
-- Safe to apply during low-traffic window; non-blocking.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS replay_url TEXT;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS replay_recorded_at TIMESTAMPTZ;

-- No index needed today. Add one if/when we expose a "recent replays"
-- discovery feed that filters on replay_url IS NOT NULL.
