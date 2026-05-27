-- 064_projects_scheduled_live_at.sql
-- Adds projects.scheduled_live_at — the keystone for the weekly
-- merchant retention loop identified in the operator-sprint
-- retention audit. Merchants set a recurring weekly slot ("Going
-- live Tuesdays at 5pm"); the storefront surfaces a banner so
-- returning customers see the next live time even when the
-- merchant isn't broadcasting.
--
-- WHAT THIS DOES
-- --------------
-- One nullable timestamptz column. NULL = no schedule set (every
-- existing row defaults to NULL — no data backfill required).
-- Non-NULL = the merchant has scheduled an upcoming go-live; the
-- frontend renders the banner. Past timestamps are ignored client-
-- side (no DB churn to clear stale values — that drift is fine).
--
-- TYPE: TIMESTAMPTZ so the value is stored in UTC and rendered
-- per-viewer timezone on the client. Matches existing
-- last_heartbeat_at (migration 059) and merchant_monthly_usage
-- conventions.
--
-- RLS: no policy changes. projects already has deny_all on
-- anon/authenticated (migration 062) + per-row owner SELECT/UPDATE
-- policies. service_role bypasses; backend writes go through
-- service_role on the PATCH /api/projects/{id} handler. RLS-wise
-- this is a no-op.
--
-- ROLLBACK
-- --------
-- rollback/064_rollback.sql — DROP COLUMN. Safe to run because
-- nothing else in the schema depends on this column.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS scheduled_live_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.projects.scheduled_live_at IS
  'When the merchant plans to go live next. Surfaced on the storefront as a "Going live..." banner. NULL = no schedule. Past values ignored client-side; backend does not auto-clear them.';

COMMIT;
