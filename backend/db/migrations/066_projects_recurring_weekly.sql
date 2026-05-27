-- 066_projects_recurring_weekly.sql
-- Optional merchant opt-in: after a scheduled_live_at fires, the
-- schedule_rollforward cron worker bumps scheduled_live_at by +7 days
-- so the merchant doesn't have to re-set the schedule every week.
--
-- recurring_weekly defaults to FALSE so this migration is purely
-- additive: every existing project keeps the manual-schedule behavior
-- shipped in migration 064 until the merchant flips the toggle.
--
-- RLS unchanged. service_role writes via PATCH /api/projects/{id};
-- merchant_plan_limits / overage / cap math don't depend on this flag.

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS recurring_weekly BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.projects.recurring_weekly IS
  'When TRUE, the schedule_rollforward cron auto-advances scheduled_live_at by +7 days after each slot passes. Defaults FALSE (manual reschedule). Merchant opt-in via the dashboard ScheduleNextLiveCard.';

COMMIT;
