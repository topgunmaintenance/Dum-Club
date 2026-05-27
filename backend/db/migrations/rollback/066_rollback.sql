-- 066_rollback.sql — drops projects.recurring_weekly.
-- Safe at any time; column has no downstream dependencies. Existing
-- scheduled_live_at values remain set, just stop auto-advancing.

BEGIN;
ALTER TABLE public.projects DROP COLUMN IF EXISTS recurring_weekly;
COMMIT;
