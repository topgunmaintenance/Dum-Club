-- 089_replay_viewer_seconds.sql
-- replay-viewer-hour-metering (2026-07-06): recorded-video watch time
-- meters against the SAME monthly viewer-hour budget as live hours.
-- viewer_seconds stays the combined total every gate/meter/biller
-- reads; replay_viewer_seconds records the recorded-video share so
-- the host meter can show a live vs recorded split.

ALTER TABLE merchant_monthly_usage
  ADD COLUMN IF NOT EXISTS replay_viewer_seconds bigint NOT NULL DEFAULT 0;
