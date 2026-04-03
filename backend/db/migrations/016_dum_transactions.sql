-- DUM Points transaction history
-- Logs every earn/spend/purchase event for audit trail and user visibility

CREATE TABLE IF NOT EXISTS dum_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    privy_id TEXT NOT NULL,
    amount INTEGER NOT NULL,           -- positive = earn, negative = spend
    reason TEXT NOT NULL,               -- "purchase_reward", "launch_bonus", "offer_created", "discount_spend", "stripe_purchase"
    reference_id TEXT,                  -- offer_id, project_id, stripe_session_id, etc.
    balance_after INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user history lookups
CREATE INDEX IF NOT EXISTS idx_dum_transactions_privy_id ON dum_transactions(privy_id);
CREATE INDEX IF NOT EXISTS idx_dum_transactions_created_at ON dum_transactions(created_at DESC);
