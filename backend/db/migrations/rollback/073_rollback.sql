-- 073_rollback.sql
-- Rollback for 073_tighten_offers_bucket_rls.sql.
--
-- Restores the three wide-open INSERT policies on storage.objects for
-- the offers bucket in their pre-073 shape (verbatim from pg_policies
-- preflight: roles + with_check_expr).
--
-- CREATE POLICY does not support IF NOT EXISTS; run only after
-- confirming via pg_policies that the policies are absent.

CREATE POLICY "Allow anon uploads to offers"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'offers'::text);

CREATE POLICY "Allow authenticated uploads to offers"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'offers'::text);

CREATE POLICY "Allow authenticated uploads"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'offers'::text);
