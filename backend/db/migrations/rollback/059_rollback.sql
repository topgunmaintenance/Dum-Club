-- 059_rollback.sql
-- Reverses migration 059_projects_last_heartbeat_at.
--
-- WHEN TO USE
-- -----------
-- Run if the Phase 0 persistent-heartbeat changes need to be unwound
-- (e.g. backend deploy reverted and stale-clear should return to the
-- pre-059 in-memory-only behavior).
--
-- SAFETY
-- ------
-- Dropping the column is safe because every read in the codebase
-- treats the column as optional. The fallback path in
-- services/live_limits.is_heartbeat_stale() catches the missing-column
-- error and returns False (no signal). The startup sweep in
-- backend/main.py catches the missing-column error and logs.
--
-- IDEMPOTENT
-- ----------
-- DROP INDEX IF EXISTS and ALTER TABLE ... DROP COLUMN IF EXISTS make
-- this safe to re-run.

BEGIN;

DROP INDEX  IF EXISTS public.idx_projects_live_heartbeat;
ALTER TABLE public.projects DROP COLUMN IF EXISTS last_heartbeat_at;

COMMIT;
