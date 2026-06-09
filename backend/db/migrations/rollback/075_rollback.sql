-- 075_rollback.sql
-- Rollback for 075_business_profiles_multi_per_owner.sql.
--
-- Re-tighten the business_profiles schema to one-business-per-DID and a
-- mandatory project_id.
--
-- NOTE — fails-by-design when relaxed-schema rows exist: the UNIQUE
-- re-adds only succeed if no owner currently holds >1 profile, and the
-- SET NOT NULL only succeeds if no row has a NULL project_id. If any
-- multi-business or standalone (null-project) rows were created under
-- the relaxed schema, these statements raise — that's the signal a clean
-- rollback isn't possible without first reconciling the new rows.

ALTER TABLE public.business_profiles
  ADD CONSTRAINT business_profiles_owner_privy_id_key UNIQUE (owner_privy_id);
ALTER TABLE public.business_profiles
  ADD CONSTRAINT business_profiles_privy_id_key UNIQUE (privy_id);
ALTER TABLE public.business_profiles
  ALTER COLUMN project_id SET NOT NULL;
