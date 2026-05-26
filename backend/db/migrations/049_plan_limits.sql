-- 049_plan_limits.sql
-- Per-PLAN config reference. One row per tier. Read-only to the app via
-- service role. Shared config table read by BOTH the cap PRs (2a/2b) and
-- the commission PR (PR-COMM). This migration creates the table and
-- seeds it; no feature PR re-creates or alters it.
--
-- Relationship to migration 048's merchant_plan_limits:
--   plan_limits           = per-PLAN defaults, keyed by plan_id text.
--   merchant_plan_limits  = per-MERCHANT overrides, keyed by merchant_id.
-- They are two distinct layers, not duplicates. Resolution at read time
-- is: merchant override -> plan default -> (for caps) NULL means resolve
-- per merchant (Business/Enterprise), NOT "unlimited"; (for commission)
-- NULL means rate is unset and the sale setup must fail closed.
--
-- 0.00 on a NULL-able rate column is a deliberate value (a comp / promo)
-- distinct from NULL (unset). Resolution code must use `is not None`
-- checks, never truthiness.
--
-- Rollback: DROP TABLE plan_limits. Nothing references it yet (cap and
-- commission enforcement read by plan_id string; no FKs into this table),
-- so the drop is clean and total.

CREATE TABLE plan_limits (
    plan_id                 TEXT          PRIMARY KEY,
    price_usd               NUMERIC(10,2) NOT NULL,
    included_vh             NUMERIC(10,2),                           -- NULL = custom per merchant
    max_concurrent          INTEGER,                                  -- NULL = custom per merchant
    max_concurrent_streams  INTEGER,                                  -- NULL = custom per merchant
    overage_rate            NUMERIC(6,4)  NOT NULL,                   -- $/viewer-hour
    hard_block_multiplier   NUMERIC(4,2)  NOT NULL DEFAULT 3.0,
    commission_rate         NUMERIC(5,4),                             -- NULL = unset (fail closed);
                                                                      -- 0.00 = deliberate comp
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT ck_price_nonneg      CHECK (price_usd >= 0),
    CONSTRAINT ck_included_vh       CHECK (included_vh IS NULL OR included_vh >= 0),
    CONSTRAINT ck_max_concurrent    CHECK (max_concurrent IS NULL OR max_concurrent >= 1),
    CONSTRAINT ck_max_streams       CHECK (max_concurrent_streams IS NULL OR max_concurrent_streams >= 1),
    CONSTRAINT ck_overage_nonneg    CHECK (overage_rate >= 0),
    CONSTRAINT ck_block_mult        CHECK (hard_block_multiplier >= 1),
    CONSTRAINT ck_commission_bounds CHECK (commission_rate IS NULL
                                           OR (commission_rate >= 0 AND commission_rate <= 0.5))
);

-- RLS: deny-all except service role (matches the migration 048 pattern).
-- No policies created => only service role / bypass-RLS connections read or write.
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

-- Seed: final intended state. Flat 1% commission on all five tiers.
-- Business/Enterprise caps are NULL = resolve per merchant before they go live,
-- NEVER "unlimited". Enforcement must fail closed on a NULL cap.
INSERT INTO plan_limits
    (plan_id,     price_usd, included_vh, max_concurrent, max_concurrent_streams,
     overage_rate, hard_block_multiplier, commission_rate)
VALUES
    ('starter',      39.00,   250,  250,    1,    0.13, 3.0, 0.0100),
    ('growth',       99.00,   700,  600,    1,    0.12, 3.0, 0.0100),
    ('pro',         299.00,  1500, 2000,    3,    0.10, 3.0, 0.0100),
    ('business',    499.00,  NULL, NULL, NULL,    0.10, 3.0, 0.0100),
    ('enterprise', 2000.00,  NULL, NULL, NULL,    0.08, 3.0, 0.0100);
