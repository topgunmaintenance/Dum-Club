-- Migration 081: live_offer_claims (comment-to-buy claim ledger)
--
-- ⚠️  DRAFT — NOT APPLIED. Authored for review only. Do NOT run this
--     against any database until approved.
--
-- WHY
-- ---
-- Comment-to-buy: during a live show a viewer types a claim keyword (e.g.
-- "!buy") in chat to claim/reserve the active PINNED offer and open Stripe
-- checkout. This table records each claim so we can (a) show a live
-- "X just claimed!" feed, (b) drive the "N left" counter, and (c) reserve
-- inventory for the short window between the claim and checkout completion.
--
-- ── COLUMN-NAMING RECONCILIATION (flagged, not silently chosen) ───────
-- The build brief's convention example is "merchant_id UUID FK ON DELETE
-- CASCADE". A claim is NOT merchant-scoped — it is BUYER-scoped, per
-- offer, per project, exactly like the `orders` table (offers_orders /
-- 010). So this table mirrors `orders`' shape: project_id + offer_id UUID
-- FKs (ON DELETE CASCADE) + buyer_privy_id TEXT — NOT merchant_id. This is
-- a deliberate match to the orders precedent, not a new 4th naming style;
-- the merchant is reachable via offers.project_id -> projects ->
-- business_profiles when needed. Everything else follows the convention
-- bundle: BIGSERIAL id, snake_case, created_at TIMESTAMPTZ NOT NULL
-- DEFAULT NOW(), RLS deny-all (061/062).
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS public.live_offer_claims (
    id              BIGSERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    offer_id        UUID NOT NULL REFERENCES public.offers(id)   ON DELETE CASCADE,
    buyer_privy_id  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'claimed'
                        CHECK (status IN ('claimed', 'checkout_started', 'purchased', 'expired', 'released')),
    keyword         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Reservation window; a reaper releases stale 'claimed' rows back to
    -- inventory. NULL = no expiry tracking (degraded / pre-reaper).
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_live_offer_claims_offer
    ON public.live_offer_claims (offer_id, status);
CREATE INDEX IF NOT EXISTS idx_live_offer_claims_project
    ON public.live_offer_claims (project_id, created_at DESC);

-- One ACTIVE claim per buyer per offer (idempotent re-claim / anti-spam).
-- Partial unique so a buyer can claim again after a prior claim resolved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_offer_claims_active_uniq
    ON public.live_offer_claims (offer_id, buyer_privy_id)
    WHERE status IN ('claimed', 'checkout_started');

-- RLS: deny-all; all access is service-role mediated (claim endpoint).
ALTER TABLE public.live_offer_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_all ON public.live_offer_claims;
CREATE POLICY deny_all ON public.live_offer_claims
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
