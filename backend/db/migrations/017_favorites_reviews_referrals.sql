-- Phase 4 & 5: Favorites, Reviews, Referrals
-- ────────────────────────────────────────────

-- Favorites / saved businesses
CREATE TABLE IF NOT EXISTS favorites (
  id          BIGSERIAL PRIMARY KEY,
  privy_id    TEXT NOT NULL,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(privy_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(privy_id);
CREATE INDEX IF NOT EXISTS idx_favorites_project ON favorites(project_id);

-- Reviews / ratings
CREATE TABLE IF NOT EXISTS reviews (
  id          BIGSERIAL PRIMARY KEY,
  privy_id    TEXT NOT NULL,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment     TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(privy_id, project_id)  -- one review per user per project
);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);

-- Referral codes
CREATE TABLE IF NOT EXISTS referrals (
  id              BIGSERIAL PRIMARY KEY,
  privy_id        TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  clicks          INT DEFAULT 0,
  signups         INT DEFAULT 0,
  points_earned   INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referrals_user ON referrals(privy_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(code);
