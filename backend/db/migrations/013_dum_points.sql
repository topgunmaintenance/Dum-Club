-- Migration: Add DUM Points balance to users table
-- Run this in Supabase SQL Editor BEFORE deploying the backend changes

-- ── User DUM balance ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS dum_balance INTEGER DEFAULT 50 NOT NULL;

-- ── Business DUM received (per project) ──
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dum_received INTEGER DEFAULT 0 NOT NULL;

-- ── Index for leaderboard queries ──
CREATE INDEX IF NOT EXISTS idx_users_dum_balance ON users (dum_balance DESC);

-- Notes:
-- dum_balance: user's spendable DUM Points. Default 50 (welcome bonus).
-- dum_received: total DUM Points received by this project from customer discounts.
-- No transaction log table yet — can add later for audit trail.
-- All values are integers (no decimals for points).
