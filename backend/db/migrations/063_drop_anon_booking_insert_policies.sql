-- 063_drop_anon_booking_insert_policies.sql
-- Closes the anonymous INSERT surface on public.bookings.
--
-- BACKGROUND
-- ----------
-- The Supabase Advisor's `rls_policy_always_true` lint flagged two
-- permissive INSERT policies on public.bookings:
--
--   Policy "Anyone can create booking" — FOR INSERT WITH CHECK (true)
--   Policy "Insert booking"            — FOR INSERT WITH CHECK (true)
--
-- Both target the `{public}` PG pseudo-role (i.e. anon + authenticated
-- + every other role except service_role's BYPASSRLS path). Either
-- policy on its own is sufficient to let any caller using the
-- browser-side Supabase anon key POST a row directly into
-- /rest/v1/bookings, bypassing the FastAPI handler and the business
-- logic in the `book_slot` RPC.
--
-- The FastAPI handler at POST /api/projects/{project_id}/book has been
-- changed to return 410 Gone in the same PR — bookings are disabled
-- for the MVP. This migration enforces the same posture at the
-- database layer.
--
-- WHAT THIS DOES
-- --------------
-- Drops the two permissive INSERT policies. With them gone, the only
-- policy on bookings that mentions INSERT is migration 062's
-- `deny_all` (FOR ALL TO anon, authenticated USING (false) WITH
-- CHECK (false)) — which is permissive but evaluates to false, so it
-- adds zero rows. Postgres RLS then rejects any anon/authenticated
-- INSERT because no permissive policy permits the row.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- - Does NOT touch the existing SELECT or UPDATE policies on bookings
--   (`Public read own`, `Read own or owned project bookings`,
--   `Only owner can update booking`, `Owner update`). Those scope
--   reads/updates to the customer or project owner via auth.uid() and
--   stay in place so the verify page and owner management UI keep
--   working for existing bookings.
-- - Does NOT affect service_role writes. service_role bypasses RLS
--   via BYPASSRLS, so the existing `book_slot` RPC (called from the
--   FastAPI handler before the 410 change) would still function if
--   re-enabled. The MVP just routes 410 through the handler before
--   it can invoke that RPC.
-- - Does NOT disable RLS on bookings. RLS stays enabled (set by 062).
-- - Does NOT touch availability_slots or service_profiles policies.
--   Their public read paths are needed for owner display and for any
--   future re-enablement of booking.
--
-- WHY SAFE
-- --------
-- Verified that the only caller path that exercises anon INSERT on
-- bookings was the customer-facing /project/[id]/book page (also
-- disabled in this PR). The FastAPI handler at POST
-- /api/projects/{project_id}/book never went through PostgREST — it
-- called the `book_slot` RPC via the backend service-role client,
-- which bypasses RLS. So dropping the anon INSERT policies removes
-- only the never-officially-used direct anon-key path.
--
-- ROLLBACK
-- --------
-- rollback/063_rollback.sql — recreates the two INSERT policies as
-- they were in production prior to this migration. Restores the
-- pre-063 ability for an anon/authenticated caller to INSERT into
-- bookings via /rest/v1/bookings.

BEGIN;

DROP POLICY IF EXISTS "Anyone can create booking" ON public.bookings;
DROP POLICY IF EXISTS "Insert booking"            ON public.bookings;

-- Sanity check: assert that no permissive policy on bookings still
-- allows an anon or authenticated INSERT. The deny_all policy (FOR
-- ALL ... WITH CHECK (false)) is permissive but evaluates to false,
-- so it's allowed to remain — but any other permissive INSERT/ALL
-- policy with a truthy WITH CHECK would be a regression.
DO $$
DECLARE
  remaining int;
  detail text;
BEGIN
  SELECT COUNT(*), string_agg(policyname, ', ')
    INTO remaining, detail
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'bookings'
    AND permissive = 'PERMISSIVE'
    AND cmd IN ('INSERT', 'ALL')
    -- Exclude policies whose WITH CHECK is the literal 'false' (which
    -- includes 062's deny_all). Any other shape — NULL (defaults to
    -- true for INSERT), 'true', or a non-false expression — would let
    -- some row through.
    AND COALESCE(with_check, 'true') <> 'false';

  IF remaining > 0 THEN
    RAISE EXCEPTION
      '063 assertion failed: % permissive INSERT/ALL policy(ies) on bookings still permit writes: %',
      remaining, detail;
  END IF;
END $$;

COMMIT;
