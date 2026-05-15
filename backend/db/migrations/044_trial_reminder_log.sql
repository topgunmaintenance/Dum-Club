-- 044_trial_reminder_log.sql
-- Idempotency log for trial reminder emails. Every email send writes one row.
-- The UNIQUE (merchant_id, reminder_type) constraint guarantees the daily
-- cron + webhook handlers never double-send the same reminder to the same
-- merchant, even on retry or backfill.
--
-- reminder_type is constrained at the application layer to one of:
--   t_minus_14            sent 14 days before trial_ends_at
--   t_minus_7             sent 7 days before trial_ends_at
--   t_minus_1             sent 1 day before trial_ends_at
--   conversion_confirmed  sent on first invoice.paid after trial
--   payment_failed        sent on invoice.payment_failed
-- A CHECK constraint enforces the vocabulary so a typo on the cron side
-- cannot pollute the table.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS trial_reminder_log (
  id            BIGSERIAL PRIMARY KEY,
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  reminder_type VARCHAR(32) NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_trial_reminder_type CHECK (reminder_type IN (
    't_minus_14',
    't_minus_7',
    't_minus_1',
    'conversion_confirmed',
    'payment_failed'
  )),
  CONSTRAINT uq_trial_reminder_merchant_type UNIQUE (merchant_id, reminder_type)
);

-- Lookup by merchant for support / audit ("did Julian get the T-7 email?").
CREATE INDEX IF NOT EXISTS idx_trial_reminder_log_merchant
  ON trial_reminder_log (merchant_id);

-- Lookup by send time for daily-cron observability.
CREATE INDEX IF NOT EXISTS idx_trial_reminder_log_sent_at
  ON trial_reminder_log (sent_at DESC);
