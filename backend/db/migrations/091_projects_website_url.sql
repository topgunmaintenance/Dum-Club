-- 091_projects_website_url.sql
-- "Go live on your own website" pivot (founder direction 2026-10-19).
-- Signup now asks for the merchant's own website so the post-signup
-- flow can walk them straight to installing the live bubble on it.
-- Nullable: shops with no website still sign up and use their
-- dum.club page. Stored normalised (https://, no trailing slash).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS website_url text;

COMMENT ON COLUMN projects.website_url IS
  'Merchant''s own website (https://...), collected at signup. NULL when the shop has no site.';
