-- 084_live_started_at.sql
-- Real broadcast-start timestamp, so live surfaces can ORDER and TIME streams.
-- Queued follow-up to homepage-live-rail.
--
-- NOT YET APPLIED VIA THIS FILE — the column was already applied directly to
-- prod (snzodohibhxenqwdklxs). This file records it in the repo so a DB rebuilt
-- from migrations/ matches prod. ALTER is IF NOT EXISTS, so re-applying is safe.
--
-- Written as now() in every go-live path (IVS Real-Time + manual-embed /go-live).
-- Deliberately NOT cleared on end: next go-live overwrites, and all consumers
-- gate on is_live=true, so a stale value is never read.
--
-- NULL = went live before this column existed / never went live: renders with
-- no timer and sorts last among live cards (feed-order position preserved).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS live_started_at TIMESTAMPTZ;

COMMENT ON COLUMN projects.live_started_at IS
  'UTC timestamp set to now() when a broadcast starts (IVS Real-Time or manual-embed /go-live). Not cleared on end (next go-live overwrites; all readers gate on is_live=true). NULL = pre-column / never live: no timer, sorts last among live cards.';
