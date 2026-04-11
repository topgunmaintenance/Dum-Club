-- 021_live_mvp.sql
-- Add live commerce fields to projects and source tracking to orders

-- Projects: live streaming state
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS stream_url TEXT;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS pinned_offer_id UUID;

-- Orders: track purchase source (normal, live)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'normal';

-- Index for fast discovery of live projects
CREATE INDEX IF NOT EXISTS idx_projects_is_live
ON projects(is_live)
WHERE is_live = TRUE;
