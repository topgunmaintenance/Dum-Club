-- Migration 073: tighten storage.objects INSERT policies for the offers bucket
--
-- Drops the three wide-open INSERT policies that today let any client
-- holding the anon or authenticated key write arbitrary objects into the
-- offers Storage bucket. PRs #354-#358 migrated every browser-direct
-- upload site (MerchantImageUploader, PostAndGoLive, project/[id]
-- storefront editor, popinVideoUpload) onto server-mediated FastAPI
-- endpoints that write using SUPABASE_SERVICE_KEY (BYPASSRLS), so these
-- policies are no longer reachable by any frontend code.
--
-- Confirmed before applying:
--   - preflight pg_policies enumeration showed exactly these three
--     INSERT policies on storage.objects whose with_check is
--     (bucket_id = 'offers'::text)
--   - 24h spot-check returned 0 rows for non-service-role INSERTs into
--     the offers bucket, confirming no missed upload site
--   - both SELECT (public-read) policies for the offers bucket are
--     LEFT UNTOUCHED so every previously-uploaded image and video
--     keeps resolving via its public URL
--
-- Forward-only. Idempotent (IF EXISTS). Pure subtractive DDL — no new
-- policies, no RLS toggle, no grants changed.
--
-- Rollback: backend/db/migrations/rollback/073_rollback.sql restores
-- all three policies in their original shape (verbatim from pg_policies
-- preflight).
--
-- Run via Supabase MCP apply_migration.

DROP POLICY IF EXISTS "Allow anon uploads to offers"          ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to offers" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"           ON storage.objects;
