-- 020_rewards_agent.sql
-- Add attribution + reward campaign tracking for RewardsAgent

-- dum_transactions → which business generated this reward
ALTER TABLE dum_transactions
ADD COLUMN IF NOT EXISTS business_candidate_id UUID;

-- purchase_proofs → reward classification + referral tracking
ALTER TABLE purchase_proofs
ADD COLUMN IF NOT EXISTS campaign_type TEXT;

ALTER TABLE purchase_proofs
ADD COLUMN IF NOT EXISTS referring_privy_id TEXT;

-- Index for fast aggregation / analytics
CREATE INDEX IF NOT EXISTS idx_dum_transactions_business_candidate
ON dum_transactions(business_candidate_id)
WHERE business_candidate_id IS NOT NULL;
