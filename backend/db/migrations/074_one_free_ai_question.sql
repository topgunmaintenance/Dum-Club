-- Migration 074: one-free-AI-question doctrine enforcement
--
-- Removes the per-project ai_free_question_limit override capability at
-- the doctrine level. After this migration:
--   - Column default is 1 (was 3). New inserts via signup land at 1.
--   - All 61 existing active rows currently at 3 are backfilled to 1.
--   - The column itself is KEPT so the schema shape stays additive and
--     future per-tier tuning is still possible if doctrine ever changes.
--
-- Sibling code change (same PR): backend/api/routes/chat.py:464 hardcodes
-- `free_limit = 1` regardless of the stored column value. The column
-- becomes informational only — the runtime cap is enforced by code.
--
-- Preflight (confirmed read-only before apply):
--   - column_default = '3'
--   - 61 active rows at 3, 0 at 1, 0 NULL, 0 other
--
-- Post-apply verification (confirmed in same session):
--   - column_default = '1', 61 active rows at 1, 0 at 3, 0 NULL
--
-- Forward-only. Idempotent on re-run (the UPDATE WHERE clause filters
-- the rows that need flipping; SET DEFAULT is a no-op if already 1).
-- Run via Supabase MCP apply_migration.

ALTER TABLE projects
  ALTER COLUMN ai_free_question_limit SET DEFAULT 1;

UPDATE projects
   SET ai_free_question_limit = 1
 WHERE ai_free_question_limit = 3
   AND is_deleted = false;
