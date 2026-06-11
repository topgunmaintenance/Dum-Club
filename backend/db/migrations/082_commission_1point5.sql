-- 082_commission_1point5.sql
-- Raise the platform sales fee from 1% to 1.5% on every plan tier.
--
-- ⚠️  NOT YET APPLIED TO PRODUCTION. This file ships in the PR for review;
--     the operator applies it to the prod DB (snzodohibhxenqwdklxs) out of
--     band. Until then the live charged rate stays at migration 054's 0.0100.
--
-- DOCTRINE: the owner has explicitly authorized raising the cap from 1% to
-- 1.5% (CLAUDE.md §12 Rule 1 updated in this same PR). Supersedes 053's
-- zeroing and 054's 0.0100; this migration sets every tier to 0.0150.
--
-- commission_rate is NUMERIC(5,4) — a FRACTION, so 0.0150 = 1.5% (NOT 1.5).
-- The column CHECK bound from 049 is [0, 0.5] (50%), so 0.0150 is well within
-- range; NO schema/constraint change is needed.
--
-- Resolution order (unchanged, still fail-closed in commission.py):
--   1. merchants.commission_rate_override (if NOT NULL — incl. 0.0000 comps)
--   2. plan_limits.commission_rate via merchants.plan_id   <-- set here
--   3. raise CommissionRateUnset (fail closed)
-- Per-merchant overrides are NOT touched — a comp/promo override (e.g. 0.0000)
-- still wins over this plan default.
--
-- Idempotent: IS DISTINCT FROM makes this re-runnable; a second run touches
-- zero rows. Also normalizes any NULL tier to 0.0150 (doctrine wants the rate
-- stated explicitly, never "absence of a rate").

UPDATE plan_limits
   SET commission_rate = 0.0150,
       updated_at      = now()
 WHERE commission_rate IS DISTINCT FROM 0.0150;
