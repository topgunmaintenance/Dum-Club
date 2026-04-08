-- Migration 019: Purchase Proof Agent persistence fields.
--
-- Adds agent output columns to purchase_proofs so the route can persist
-- parsed merchant/amount/date, agent confidence, decision, and notes.
-- All columns are nullable / defaulted — zero risk to existing rows, no
-- backfill required, no destructive changes.
--
-- See backend/services/agents/purchase_proof.py for the values written
-- into these columns.

ALTER TABLE purchase_proofs
  ADD COLUMN IF NOT EXISTS parsed_merchant TEXT,
  ADD COLUMN IF NOT EXISTS parsed_amount   NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS parsed_date     DATE,
  ADD COLUMN IF NOT EXISTS confidence      NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS agent_decision  TEXT,
  ADD COLUMN IF NOT EXISTS agent_notes     TEXT;

-- Index on agent_decision so the admin queue can filter by it once
-- a UI surfaces agent output. Small table, cheap index.
CREATE INDEX IF NOT EXISTS idx_purchase_proofs_agent_decision
  ON purchase_proofs (agent_decision)
  WHERE agent_decision IS NOT NULL;
