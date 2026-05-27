-- 063_rollback.sql — restores the two anon INSERT policies that
-- 063 dropped from public.bookings.
--
-- WHEN TO USE
-- -----------
-- Only if re-enabling public bookings AND the FastAPI 410 has been
-- reverted in the same deploy. This rollback restores the pre-063
-- ability for any caller using the anon key to POST a row into
-- /rest/v1/bookings — the same anon-INSERT surface that the
-- Supabase Advisor previously flagged. Do NOT apply this rollback
-- in isolation; it weakens the production security posture without
-- restoring any user-facing functionality on its own.
--
-- WHAT THIS RESTORES
-- ------------------
-- Two PERMISSIVE INSERT policies targeting the `{public}` PG
-- pseudo-role with WITH CHECK (true). Definitions taken from the
-- pre-063 production state captured via pg_policies.

BEGIN;

CREATE POLICY "Anyone can create booking"
  ON public.bookings
  FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Insert booking"
  ON public.bookings
  FOR INSERT
  TO public
  WITH CHECK (true);

COMMIT;
