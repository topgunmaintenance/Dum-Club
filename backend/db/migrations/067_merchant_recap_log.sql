-- 067_merchant_recap_log.sql
-- Idempotency log for the weekly merchant recap email.
--
-- Every send writes one row. The UNIQUE (merchant_id, recap_week)
-- constraint guarantees the weekly cron never double-sends a recap
-- to the same merchant for the same ISO week, even on retry or
-- backfill. Same pattern as 044_trial_reminder_log.sql.
--
-- recap_week is the ISO 8601 week label, e.g. '2026-W21'. The
-- application code computes it as the week that just ENDED at the
-- moment the cron runs (Monday 09:00 ET → recap covers the
-- previous Mon-Sun, labelled with that week's ISO week id).
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS merchant_recap_log (
  id            BIGSERIAL PRIMARY KEY,
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  recap_week    VARCHAR(8) NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Snapshot of the numbers we put in the email so support can
  -- explain "why did my recap say 3 lives" without re-querying.
  -- Non-authoritative; the source of truth is stream_sessions + orders.
  lives_count       INTEGER,
  viewer_hours      NUMERIC(10,2),
  sales_count       INTEGER,
  gmv_usd           NUMERIC(10,2),
  top_offer_title   TEXT,
  next_live_at      TIMESTAMPTZ,
  CONSTRAINT uq_merchant_recap_week UNIQUE (merchant_id, recap_week)
);

-- Lookup by merchant for support / audit
-- ("did Topgun get last week's recap?").
CREATE INDEX IF NOT EXISTS idx_merchant_recap_log_merchant
  ON merchant_recap_log (merchant_id);

-- Lookup by send time for weekly-cron observability.
CREATE INDEX IF NOT EXISTS idx_merchant_recap_log_sent_at
  ON merchant_recap_log (sent_at DESC);

-- RLS: deny-all by default (service role only). Same posture as
-- trial_reminder_log + every other operator-only table.
ALTER TABLE merchant_recap_log ENABLE ROW LEVEL SECURITY;
