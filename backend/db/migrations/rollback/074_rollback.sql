-- 074_rollback.sql
-- Rollback for 074_one_free_ai_question.sql.
--
-- Restores the per-project ai_free_question_limit column default to 3
-- and flips every active row currently at 1 back to 3. The code-side
-- rollback (git revert of the PR 2 chat.py change) restores the
-- column-read path so per-project overrides become honored again.
--
-- Run via Supabase MCP apply_migration. The UPDATE flips ALL active
-- rows currently at 1, including any net-new signups during the
-- post-074 window. If specific post-074 rows should be preserved at 1,
-- narrow the WHERE clause manually before run.

ALTER TABLE projects
  ALTER COLUMN ai_free_question_limit SET DEFAULT 3;

UPDATE projects
   SET ai_free_question_limit = 3
 WHERE ai_free_question_limit = 1
   AND is_deleted = false;
