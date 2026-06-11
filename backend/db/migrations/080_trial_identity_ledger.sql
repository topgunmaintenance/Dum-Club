-- Migration 080: trial_identity_ledger (trial-abuse dedupe)
--
-- ⚠️  DRAFT — NOT APPLIED. Authored for review only. Do NOT run this
--     against any database until approved.
--
-- WHY
-- ---
-- The 60-day trial requires no card at signup (services/subscriptions.py:
-- trial_period_days=60, pause-on-missing-payment-method). Without a gate,
-- one person can claim the free trial repeatedly under new accounts. This
-- ledger records ONE row per granted trial, keyed by a SALTED HASH of the
-- merchant's email — never the raw email or any other PII. The UNIQUE
-- constraint on the hash is the dedupe backstop; the application gate
-- (services/trial_identity.py, wired in merchant.py merchant_signup) checks
-- it before granting and is FAIL-CLOSED.
--
-- ACTIVATION (kept inert until the operator does BOTH):
--   1. Apply this migration.
--   2. Set TRIAL_IDENTITY_GATE_ENABLED=true (and TRIAL_IDENTITY_SALT=<secret>)
--      on the backend. Until the flag is on, the gate code is a no-op and
--      trials are granted exactly as today.
--
-- CONVENTIONS: matches 044_trial_reminder_log exactly — BIGSERIAL id,
-- merchant_id UUID FK ON DELETE CASCADE, TIMESTAMPTZ NOT NULL DEFAULT NOW(),
-- RLS deny-all (061/062 pattern). Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.trial_identity_ledger (
    id            BIGSERIAL PRIMARY KEY,
    merchant_id   UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    -- Salted SHA-256 of the normalized email. NO raw email/PII is stored.
    identity_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One granted trial per identity — the dedupe backstop behind the
    -- application gate.
    CONSTRAINT trial_identity_ledger_hash_uniq UNIQUE (identity_hash)
);

CREATE INDEX IF NOT EXISTS idx_trial_identity_ledger_merchant
    ON public.trial_identity_ledger (merchant_id);

-- RLS: deny-all; all access is service-role mediated (merchant signup).
ALTER TABLE public.trial_identity_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON public.trial_identity_ledger;
CREATE POLICY deny_all ON public.trial_identity_ledger
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
