-- 036_merchant_analytics_events.sql
-- Drive Your Market Analytics — minimal events table.
--
-- Captures the events that orders + projects.view_count don't:
-- embed mounts, project views with visitor identity, offer views,
-- checkout starts, return visits. Purchase events are also written
-- here for funnel-rate calculations even though orders is the source
-- of truth for revenue / order-count totals.
--
-- Privacy: anonymous_visitor_id is a client-side UUID stored in the
-- merchant's iframe localStorage scope. No IP, no device fingerprint,
-- no precise location. session_id rotates per browser session.

CREATE TABLE IF NOT EXISTS merchant_analytics_events (
    id                   BIGSERIAL PRIMARY KEY,
    merchant_id          UUID,
    project_id           UUID REFERENCES projects(id) ON DELETE CASCADE,
    offer_id             UUID REFERENCES offers(id) ON DELETE SET NULL,
    event_type           TEXT NOT NULL CHECK (event_type IN (
        'embed_view',
        'project_view',
        'offer_view',
        'checkout_start',
        'purchase_completed',
        'live_view',
        'return_visit'
    )),
    anonymous_visitor_id TEXT,
    session_id           TEXT,
    order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,
    amount_cents         INTEGER,
    metadata             JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot paths:
--   1. dashboard summary by project, recent-first
CREATE INDEX IF NOT EXISTS idx_mae_project_time
  ON merchant_analytics_events (project_id, created_at DESC);

--   2. dashboard summary by merchant (when merchant_id is populated)
CREATE INDEX IF NOT EXISTS idx_mae_merchant_time
  ON merchant_analytics_events (merchant_id, created_at DESC)
  WHERE merchant_id IS NOT NULL;

--   3. unique-visitor / returning-visitor counts per project
CREATE INDEX IF NOT EXISTS idx_mae_visitor_project
  ON merchant_analytics_events (project_id, anonymous_visitor_id)
  WHERE anonymous_visitor_id IS NOT NULL;

--   4. event-type filters (e.g. count checkout_starts in last 30d)
CREATE INDEX IF NOT EXISTS idx_mae_type_project_time
  ON merchant_analytics_events (event_type, project_id, created_at DESC);

COMMENT ON TABLE merchant_analytics_events IS
  'Drive Your Market Analytics — visitor / view / checkout / purchase events. Privacy-first: anonymous_visitor_id only, no IP / device / location.';
