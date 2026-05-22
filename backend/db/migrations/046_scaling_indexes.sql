-- Migration 046 — scaling indexes for 1,000+ merchants
--
-- Operator: apply during a low-traffic window. CREATE INDEX CONCURRENTLY
-- is non-blocking (no table lock) but CANNOT run inside a transaction
-- block — apply each statement individually (e.g. psql one-by-one, or a
-- runner that does NOT wrap the file in a single BEGIN/COMMIT). Each
-- index can take seconds-to-minutes at scale.
--
-- Scope note: most of the indexes a generic "add scaling indexes" pass
-- would propose ALREADY EXIST in this schema under their own names —
-- idx_projects_slug_unique, idx_projects_verified,
-- idx_projects_visibility_public, idx_projects_is_live,
-- idx_projects_sort_order, projects_category_idx, idx_offers_project_id,
-- offers_active_deal_idx, idx_orders_project_id, idx_users_dum_balance,
-- idx_business_profiles_owner, idx_merchants_stripe, etc. This migration
-- adds ONLY the genuinely-missing indexes that match real query patterns.
-- It deliberately does NOT add indexes for columns that don't exist in
-- this schema (there is no projects.deleted_at — it's is_deleted; there
-- is no orders.merchant_id — orders link via project_id; there is no
-- dum_points table — balances live on users.dum_balance).

-- ── Hot path: the /api/projects/discover server-side market loop ──
-- compute_market_snapshot() (backend/api/routes/market.py) runs per
-- project on every /discover load and filters these two tables by
-- project_id (project_market_state for the price row,
-- project_balances summed for circulating supply). Without an index a
-- 1,000-merchant feed does sequential scans per card. These two tables
-- are created out-of-band in Supabase (no CREATE TABLE in this
-- migration tree) — confirm they exist with the expected project_id
-- column before applying. IF NOT EXISTS makes re-runs a no-op.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_balances_project_id
    ON project_balances(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_market_state_project_id
    ON project_market_state(project_id);

-- ── Public listing sort ──
-- list_public_projects() does `.order("created_at", desc=True).limit(50)`
-- on the standard pass. An index on created_at DESC backs that sort
-- directly. (Filter columns visibility/verified/is_live already have
-- their own indexes; this covers the ORDER BY.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_created_at
    ON projects(created_at DESC);

-- ── NOT added, and why ──
-- * Full-text search GIN index: /api/projects/discover filters search in
--   Python over the already-capped public list (not via SQL to_tsquery),
--   so a tsvector GIN index would be unused today. Add it together with a
--   SQL-side search rewrite if/when the list cap is lifted.
-- * orders(merchant_id, ...): no merchant_id column on orders.
-- * dum_points(user_id): no dum_points table; users.dum_balance is
--   already indexed (idx_users_dum_balance).
