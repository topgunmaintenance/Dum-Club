-- Add privy_id to projects as a fallback ownership anchor.
-- No FK — just a text reference to the Privy DID.
-- Used when wallet_address is not yet linked; owner_id can be NULL meanwhile.
-- backfill-owner upgrades owner_id to profiles.id when a wallet appears.

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS privy_id TEXT;
