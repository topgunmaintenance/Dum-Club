-- 038_projects_popin_config.sql
-- DUM Pop-In Seller — per-project merchant settings.
--
-- Mirrors the precedent set by ai_agent_config (migration 032) and
-- hours_weekly (migration 035): a JSONB column on `projects` that
-- the embed reads alongside the existing project payload and the
-- dashboard writes via the PATCH /api/projects/{id} endpoint.
--
-- Empty object means "use client-side defaults" — strictly backwards
-- compatible with the PR #133 MVP which had no settings at all.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS popin_config JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN projects.popin_config IS
  'Per-project DUM Pop-In Seller settings. Empty object means client-side
   defaults. Shape: { enabled?: bool, greeting?: string,
   returning_greeting?: string, delay_seconds?: number,
   once_per_session?: bool, offer_id?: uuid, mode?: "bubble" }.
   Only "bubble" mode is active today; recorded / live / auto are
   forward-declared but rejected by the API until those features ship.';
