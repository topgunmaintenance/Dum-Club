-- 045_merchant_grace_period.sql
-- Payment-failure grace period columns. When Stripe fires
-- invoice.payment_failed we open a 3-day grace window during which the
-- merchant can update their card and resume billing. If the window
-- expires without a successful payment, a daily sweep moves the merchant
-- from subscription_status='past_due' to subscription_status='suspended',
-- which gates Go Live + new orders while keeping the rest of the
-- dashboard accessible so the merchant can still fix the card.
--
-- Two columns:
--   grace_period_starts_at — set to NOW() when invoice.payment_failed
--                            arrives. Cleared when subsequent invoice.paid
--                            event resets subscription_status to 'active'.
--   grace_period_ends_at   — grace_period_starts_at + 3 days. Used by
--                            the daily sweep and by the dashboard banner
--                            to render the "Update your card by <date>"
--                            line.
--
-- Index supports the daily sweep query
--   WHERE subscription_status = 'past_due' AND grace_period_ends_at < NOW()
--
-- Safe to re-run.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS grace_period_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at   TIMESTAMPTZ;

COMMENT ON COLUMN merchants.grace_period_starts_at IS
  'When the 3-day payment-failure grace window opened. Set on invoice.payment_failed. Cleared on subsequent invoice.paid.';
COMMENT ON COLUMN merchants.grace_period_ends_at IS
  'When the 3-day grace window expires. After this, the daily sweep flips subscription_status to ''suspended''.';

CREATE INDEX IF NOT EXISTS idx_merchants_grace_period_ends_at
  ON merchants (grace_period_ends_at)
  WHERE grace_period_ends_at IS NOT NULL;
