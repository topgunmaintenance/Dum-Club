-- Migration 078: reviews body length cap (EXTENDS the existing reviews table)
--
-- ⚠️  DRAFT — NOT APPLIED. Authored for review only. Do NOT run this
--     against any database until approved.
--
-- CONTEXT
-- -------
-- The `reviews` table ALREADY EXISTS (migration 017_favorites_reviews_
-- referrals.sql): rating 1-5 CHECK, UNIQUE(privy_id, project_id) (one
-- review per reviewer per storefront), project_id FK ON DELETE CASCADE,
-- and idx_reviews_project. RLS deny-all is ALREADY enabled on it
-- (migration 062_enable_rls_deny_all_backfill.sql). All reads/writes go
-- through the service-role endpoints in backend/api/routes/reviews.py.
--
-- This migration does NOT recreate the table and does NOT rename columns
-- (the live endpoints + frontend use privy_id / comment). It only ADDs the
-- one schema gap from the reviews+trust spec: a 2000-character cap on the
-- review body, enforced at the DB as a backstop to the application cap.
--
-- AGGREGATE DECISION (recorded here for the reviewer)
-- ---------------------------------------------------
-- We use a READ-TIME aggregate (COUNT + AVG over idx_reviews_project in
-- GET /api/reviews/summary and /project), NOT cached review_count/
-- avg_rating columns. Justification: review volume is low, the aggregate
-- is a single indexed scan, and cached columns would need a trigger or
-- app-side updates that DRIFT on edits/deletes. Revisit a cached column
-- (with a trigger) only if the aggregate ever becomes a hot path.
--
-- Idempotent: the constraint is added only if it does not already exist.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.reviews'::regclass
          AND conname  = 'reviews_comment_len_chk'
    ) THEN
        ALTER TABLE public.reviews
            ADD CONSTRAINT reviews_comment_len_chk
            CHECK (char_length(comment) <= 2000);
    END IF;
END $$;
