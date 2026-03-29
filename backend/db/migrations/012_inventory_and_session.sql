-- Phase: Commerce hardening — inventory + session tracking
-- Run in Supabase SQL Editor

-- Add inventory fields to offers
ALTER TABLE offers ADD COLUMN IF NOT EXISTS quantity_available INTEGER DEFAULT NULL;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS quantity_sold INTEGER DEFAULT 0;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS unlimited_inventory BOOLEAN DEFAULT TRUE;

-- Add stripe_session_id to orders for reliable lookup
ALTER TABLE offers ADD COLUMN IF NOT EXISTS stripe_session_id TEXT DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id TEXT DEFAULT NULL;

-- Index for session lookup
CREATE INDEX IF NOT EXISTS idx_orders_stripe_session ON orders(stripe_session_id);
