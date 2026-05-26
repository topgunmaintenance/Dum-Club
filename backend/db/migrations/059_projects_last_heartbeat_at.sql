-- 059_projects_last_heartbeat_at.sql
-- Phase 0 livestream cost-protection: persist host heartbeat to the
-- database so stale-stream detection survives Railway restarts.
--
-- WHY
-- ---
-- Pre-this-migration the host's "/api/ivs/heartbeat" only updated an
-- in-memory dict (services/live_limits._last_heartbeat). On Railway
-- redeploy that dict is wiped, so is_heartbeat_stale() returns False
-- for every project (no signal -> conservative no-op), and any project
-- marked is_live=true at the moment of restart stays "live" forever
-- even after the host browser has closed. Viewers see a phantom-live
-- card on /discover and the embed badge says "live" indefinitely.
--
-- This column lets:
--   * the heartbeat handler persist on every poll (5s cadence)
--   * is_heartbeat_stale() fall back to the DB when in-memory is empty
--   * the FastAPI lifespan startup hook do a one-shot sweep of any
--     projects with is_live=true AND a stale (or NULL) heartbeat
--
-- WHAT
-- ----
-- One nullable column + one partial index. Additive, zero impact on
-- existing rows. is_live=true projects pre-this-migration will have
-- last_heartbeat_at=NULL; the startup sweep treats NULL as "stale"
-- so the pre-existing orphan rows clear on first deploy.
--
-- ROLLBACK
-- --------
-- ALTER TABLE public.projects DROP COLUMN IF EXISTS last_heartbeat_at;
-- DROP INDEX  IF EXISTS public.idx_projects_live_heartbeat;
--
-- Rollback is safe because the column is read-with-fallback: code that
-- references it tolerates the column being absent (existing in-memory
-- path remains).
--
-- IDEMPOTENCY
-- -----------
-- ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Re-run is
-- a no-op.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

COMMENT ON COLUMN public.projects.last_heartbeat_at IS
  'Host heartbeat from POST /api/ivs/heartbeat. Persisted on every '
  'poll (5s cadence). is_heartbeat_stale() falls back to this when '
  'the in-memory _last_heartbeat dict is empty (Railway restart). '
  'The startup sweep in main.py clears is_live on any project whose '
  'heartbeat is NULL or older than 5 minutes.';

-- Partial index keeps the startup sweep + stale-detection lookups
-- fast even as projects grows. Only indexes rows that could be
-- "live" — the conditional cuts index size dramatically.
CREATE INDEX IF NOT EXISTS idx_projects_live_heartbeat
  ON public.projects(last_heartbeat_at)
  WHERE is_live = true;

COMMIT;
