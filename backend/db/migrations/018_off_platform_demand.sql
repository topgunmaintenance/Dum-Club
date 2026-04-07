-- Migration 018: Off-platform demand capture tables
-- Adds support for external businesses, purchase proofs, and merchant outreach

-- ── External businesses (discovered via local search, not yet on DUM Club) ──
CREATE TABLE IF NOT EXISTS external_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source TEXT NOT NULL DEFAULT 'manual',          -- 'google_places', 'yelp', 'manual'
  external_place_id TEXT,                                   -- provider-specific ID
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  postal_code TEXT DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  rating DOUBLE PRECISION,
  review_count INTEGER DEFAULT 0,
  raw_data JSONB,
  status TEXT NOT NULL DEFAULT 'unclaimed',                 -- 'unclaimed', 'outreach_sent', 'claimed'
  claimed_project_id UUID REFERENCES projects(id),          -- links to DUM Club project after claim
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_businesses_place
  ON external_businesses (external_source, external_place_id)
  WHERE external_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_external_businesses_city
  ON external_businesses (lower(city));

-- ── Demand events (views, clicks, purchase claims from users) ──
CREATE TABLE IF NOT EXISTS external_business_demand_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_business_id UUID NOT NULL REFERENCES external_businesses(id),
  buyer_privy_id TEXT,                                      -- user who triggered event
  query_text TEXT DEFAULT '',
  demand_type TEXT NOT NULL DEFAULT 'view',                 -- 'view', 'click', 'purchase_claim', 'verified_purchase'
  purchase_amount_usd NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_events_business
  ON external_business_demand_events (external_business_id);

-- ── Purchase proofs (user-submitted receipts for off-platform purchases) ──
CREATE TABLE IF NOT EXISTS purchase_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_business_id UUID NOT NULL REFERENCES external_businesses(id),
  buyer_privy_id TEXT NOT NULL,
  receipt_image_url TEXT,
  receipt_text TEXT,
  purchase_amount_usd NUMERIC(10,2),
  purchase_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',                   -- 'pending', 'verified', 'rejected'
  verification_notes TEXT,
  dum_points_awarded INTEGER NOT NULL DEFAULT 0,
  duplicate_hash TEXT,                                      -- hash of receipt for dedup
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_proofs_buyer
  ON purchase_proofs (buyer_privy_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_proofs_dedup
  ON purchase_proofs (duplicate_hash)
  WHERE duplicate_hash IS NOT NULL;

-- ── Merchant outreach queue ──
CREATE TABLE IF NOT EXISTS merchant_outreach_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_business_id UUID NOT NULL REFERENCES external_businesses(id),
  trigger_source TEXT NOT NULL DEFAULT 'verified_purchase', -- what triggered outreach
  recipient_email TEXT,
  recipient_phone TEXT,
  outreach_channel TEXT NOT NULL DEFAULT 'email',           -- 'email', 'sms', 'manual'
  outreach_status TEXT NOT NULL DEFAULT 'pending',          -- 'pending', 'sent', 'failed', 'skipped'
  message_subject TEXT,
  message_body TEXT,
  claim_token TEXT,                                         -- secure token for claim link
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outreach_business
  ON merchant_outreach_queue (external_business_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_claim_token
  ON merchant_outreach_queue (claim_token)
  WHERE claim_token IS NOT NULL;
