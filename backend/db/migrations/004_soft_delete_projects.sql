-- Add soft-delete flag to projects.
-- All list/get queries filter is_deleted = false.
-- DELETE /api/projects/{id} sets this flag; only the owner may call it.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
