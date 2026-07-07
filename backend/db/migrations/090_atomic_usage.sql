-- 090_atomic_usage.sql
-- Audit finding 2 (2026-07-07): read-then-write on merchant_monthly_usage
-- loses increments — a replay beat landing while on_stream_end writes its
-- rollup could erase an entire live session's billed viewer-seconds.
-- Atomic UPSERT via a SQL function; both writers call it through RPC.

CREATE UNIQUE INDEX IF NOT EXISTS uq_monthly_usage_merchant_month
  ON merchant_monthly_usage(merchant_id, yyyymm);

CREATE OR REPLACE FUNCTION increment_monthly_usage(
  p_merchant_id uuid,
  p_yyyymm text,
  p_viewer_seconds bigint,
  p_replay_seconds bigint,
  p_stream_inc int
) RETURNS void AS $$
  INSERT INTO merchant_monthly_usage
    (merchant_id, yyyymm, stream_count, viewer_seconds, replay_viewer_seconds)
  VALUES
    (p_merchant_id, p_yyyymm, p_stream_inc, p_viewer_seconds, p_replay_seconds)
  ON CONFLICT (merchant_id, yyyymm) DO UPDATE SET
    stream_count          = merchant_monthly_usage.stream_count + EXCLUDED.stream_count,
    viewer_seconds        = merchant_monthly_usage.viewer_seconds + EXCLUDED.viewer_seconds,
    replay_viewer_seconds = merchant_monthly_usage.replay_viewer_seconds + EXCLUDED.replay_viewer_seconds,
    updated_at            = now();
$$ LANGUAGE sql;
