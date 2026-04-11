-- 022_live_auctions.sql
-- Live auction system: auctions, bids, project linkage

-- Auctions table
CREATE TABLE IF NOT EXISTS auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  offer_id UUID NOT NULL,
  started_by TEXT NOT NULL,
  starting_price NUMERIC(10,2) NOT NULL,
  current_bid NUMERIC(10,2),
  current_bidder TEXT,
  current_bidder_display TEXT,
  bid_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  duration_seconds INTEGER NOT NULL DEFAULT 120,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  winner_order_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auction bids audit log
CREATE TABLE IF NOT EXISTS auction_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES auctions(id),
  bidder_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Project linkage: which auction is currently active
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS active_auction_id UUID;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_auctions_project ON auctions(project_id);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_auction_bids_auction ON auction_bids(auction_id);
