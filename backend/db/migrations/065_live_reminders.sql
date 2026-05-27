-- 065_live_reminders.sql
-- Customer-side "remind me when this merchant goes live" subscriptions.
-- One row per (project, email, scheduled_for) tuple. The cron worker at
-- backend/services/agents/live_reminders.py wakes up periodically, finds
-- rows where scheduled_for is inside the next-send window AND sent_at
-- IS NULL, sends the reminder email via Resend, then stamps sent_at.
--
-- DATA MODEL
-- ----------
-- project_id     FK to projects (cascade-on-project-delete cleans the row).
-- customer_email Plain email address. We do NOT require a customer
--                account; the storefront sign-up surface is public.
-- scheduled_for  Copy of project.scheduled_live_at at the moment the
--                customer subscribed. Snapshot rather than join so a
--                merchant who reschedules doesn't accidentally send
--                "going live now!" emails to old subscribers for the
--                new time (those subscribers signed up for a specific
--                slot they may no longer attend).
-- sent_at        NULL until the worker sends. Indexed (where NULL)
--                so the worker can scan the un-sent queue quickly.
-- created_at     Audit + retention.
--
-- IDEMPOTENCY
-- -----------
-- UNIQUE (project_id, customer_email, scheduled_for) — the worker uses
-- INSERT ... ON CONFLICT semantics on the API-side (return success if
-- already subscribed). The send pass uses UPDATE ... WHERE sent_at IS
-- NULL so concurrent workers race safely (the row that wins the UPDATE
-- gets to send; the others see 0 rows affected and skip).
--
-- PRIVACY
-- -------
-- Customer email is PII. Row-level security restricts SELECT to
-- service_role only — no anon / authenticated reads. INSERT is allowed
-- via a tight WITH CHECK policy that accepts only the columns the
-- public sign-up endpoint sets (and rejects null/garbage emails). The
-- service_role bypasses RLS for the cron worker reads.
--
-- ROLLBACK
-- --------
-- rollback/065_rollback.sql — DROP TABLE. Safe because nothing else in
-- the schema FKs to live_reminders.

BEGIN;

CREATE TABLE IF NOT EXISTS public.live_reminders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  customer_email  TEXT NOT NULL,
  scheduled_for   TIMESTAMPTZ NOT NULL,
  sent_at         TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_live_reminders_email_shape
    CHECK (customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(customer_email) <= 320),
  CONSTRAINT uq_live_reminders_subscription
    UNIQUE (project_id, customer_email, scheduled_for)
);

-- Worker scan: find unsent reminders due soon. Partial index because
-- the vast majority of rows post-send will have sent_at NOT NULL and
-- shouldn't bloat the worker's scan.
CREATE INDEX IF NOT EXISTS idx_live_reminders_unsent_due
  ON public.live_reminders (scheduled_for)
  WHERE sent_at IS NULL;

-- Lookup by project for the storefront "X people will be notified" badge
-- (future enhancement; the index is cheap to add now).
CREATE INDEX IF NOT EXISTS idx_live_reminders_project
  ON public.live_reminders (project_id);

-- RLS posture (mirrors migration 062's deny_all baseline):
ALTER TABLE public.live_reminders ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS, so the cron worker reads + the FastAPI
-- backend writes (which uses the service-role client) are unaffected.
-- The deny_all policy keeps anon and authenticated from poking the
-- table directly via PostgREST. The signup endpoint at
-- POST /api/projects/{id}/live-reminders is the only public write
-- path, and it goes through the backend (which uses service_role).
CREATE POLICY deny_all ON public.live_reminders
  AS PERMISSIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

COMMIT;
