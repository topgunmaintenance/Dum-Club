-- One-time cleanup: map legacy token_status values onto the canonical launch lifecycle.
-- Run once in the Supabase SQL editor (or psql). Safe to re-run: only touches known legacy rows.
--
-- After data is clean, you may remove in-app normalization in backend/api/routes/token.py
-- (TOKEN_STATUS_NORMALIZE / _canonical_token_status) if you no longer need a safety net.

UPDATE projects
SET token_status = 'draft'
WHERE token_status IN ('active', 'pending');

-- Optional audit (comment out if not needed):
-- SELECT id, token_status FROM projects WHERE token_status IN ('active', 'pending');
