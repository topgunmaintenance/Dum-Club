-- 064_rollback.sql — drops projects.scheduled_live_at.
--
-- Safe to run at any time. The column is read by frontend code in
-- a NULL-tolerant way (the storefront banner is gated on a non-NULL
-- future value), and the backend PATCH handler treats it as
-- Optional, so removing it just stops persisting future schedules
-- — existing rows will read NULL and the banner disappears.

BEGIN;

ALTER TABLE public.projects DROP COLUMN IF EXISTS scheduled_live_at;

COMMIT;
