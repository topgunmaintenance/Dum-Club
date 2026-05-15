-- 042_seed_claim_audit.sql
-- Audit trail for seed-sentinel ownership rebinds.
--
-- When a real merchant signs in for the first time and the auto-claim
-- helper (backend/services/seed_claim.py) detects that their verified
-- email matches a seed business_profiles row, it rebinds owner_privy_id
-- on that row + the linked projects row from 'seed:<slug>' to the user's
-- real Privy DID. Every such rebind writes one row here so we have a
-- paper trail.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS seed_claim_audit (
  id BIGSERIAL PRIMARY KEY,
  business_profile_id UUID NOT NULL,
  old_owner_privy_id TEXT NOT NULL,
  new_owner_privy_id TEXT NOT NULL,
  matched_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seed_claim_audit_new_owner
  ON seed_claim_audit (new_owner_privy_id);

CREATE INDEX IF NOT EXISTS idx_seed_claim_audit_bp
  ON seed_claim_audit (business_profile_id);
