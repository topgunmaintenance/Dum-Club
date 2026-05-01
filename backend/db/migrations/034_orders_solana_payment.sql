-- Phase 0B/1: Solana wallet checkout columns on orders.
--
-- Adds the on-chain payment tracking surface so an order created via
-- /api/checkout/sol-confirm can be reconciled against its Solana
-- transaction. The Stripe path is unchanged — these columns are
-- mutually exclusive with stripe_payment_intent_id / stripe_session_id
-- at the row level (one order, one payment rail), but the schema
-- doesn't enforce that.
--
-- Run in Supabase SQL Editor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS solana_tx_signature TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS solana_lamports BIGINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS solana_buyer_wallet TEXT;

-- Idempotency: one paid order per on-chain transfer. Partial unique
-- index so the existing Stripe rows (NULL signature) aren't constrained.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_solana_tx_signature
    ON orders(solana_tx_signature)
    WHERE solana_tx_signature IS NOT NULL;

-- Lookup buyer's cross-merchant order history by wallet without a full
-- table scan. Same partial-index pattern.
CREATE INDEX IF NOT EXISTS idx_orders_solana_buyer_wallet
    ON orders(solana_buyer_wallet)
    WHERE solana_buyer_wallet IS NOT NULL;
