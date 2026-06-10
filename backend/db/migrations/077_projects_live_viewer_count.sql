-- Migration 077: projects.live_viewer_count
--
-- ⚠️  DRAFT — NOT APPLIED. Authored for review only.
--
-- WHY
-- ---
-- Adds a durable concurrent-viewer counter to projects. Today the live
-- viewer count exists ONLY in the in-memory live_limits._viewer_counts
-- dict (per-process, reset on every Railway restart, never shared across
-- workers). This column gives the count a persisted home so it can
-- survive restarts and be read by any worker / the Discover feed without
-- the in-memory lookup.
--
-- SAFETY
-- ------
-- Adding a NOT NULL column WITH a constant DEFAULT is a metadata-only
-- change in PostgreSQL 11+ (no full table rewrite). `projects` is small,
-- so this is safe either way. Idempotent via IF NOT EXISTS.
--
-- NOTE: this migration only adds the column. Wiring it (who writes it,
-- how it reconciles with the in-memory counter, decrement-on-disconnect)
-- is application work, not covered here.

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS live_viewer_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.projects.live_viewer_count IS
  'Persisted concurrent live-viewer count. Default 0. Durable mirror of '
  'the in-memory live_limits viewer counter; write path is application-'
  'managed (see live_limits.py).';
