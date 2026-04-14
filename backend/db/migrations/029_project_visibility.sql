-- 029_project_visibility.sql
-- Soft-hide infrastructure for the public project listing.
--
-- Adds a `visibility` column to projects so a project can be hidden from
-- /discover and /api/projects/public WITHOUT being deleted. This is the
-- non-destructive way to hide founder demo storefronts (and any future
-- test fixtures) from the public listing while keeping the underlying
-- records as test fixtures, marketing examples, and historical signal
-- of what the AI builder produces.
--
-- A project with visibility='hidden':
--   - Does NOT appear in /api/projects/public  (filtered server-side)
--   - Does NOT appear in /discover              (consequence of the above)
--   - DOES still appear to its owner via /api/projects?owner_id=...
--   - DOES still resolve via direct URL /project/:id
--   - DOES still receive payments and webhook events
--   - Is INDEPENDENT of is_deleted (which is the harder soft-delete tier)
--
-- Reversible: setting visibility back to 'public' restores the listing.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility VARCHAR NOT NULL DEFAULT 'public';

COMMENT ON COLUMN projects.visibility IS
  'Public listing visibility. public | hidden. Soft-hides a project from /discover and /api/projects/public without deleting it. Independent of is_deleted.';

-- Partial index — most queries hit visibility='public' only.
CREATE INDEX IF NOT EXISTS idx_projects_visibility_public
  ON projects(visibility)
  WHERE visibility = 'public';
