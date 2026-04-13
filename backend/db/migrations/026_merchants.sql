-- 026_merchants.sql
-- Merchant account layer — founding merchants, payment connections, pricing tiers

CREATE TABLE IF NOT EXISTS merchants (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_privy_id          TEXT NOT NULL UNIQUE,
    business_profile_id     UUID REFERENCES business_profiles(id),
    founding_merchant       BOOLEAN NOT NULL DEFAULT true,
    subscription_tier       VARCHAR NOT NULL DEFAULT 'founding',
    subscription_price_usd  DECIMAL(10,2) NOT NULL DEFAULT 0,
    platform_fee_percent    DECIMAL(5,2) NOT NULL DEFAULT 0,
    stripe_connect_id       VARCHAR,
    stripe_connect_status   VARCHAR NOT NULL DEFAULT 'not_connected',
    square_location_id      VARCHAR,
    square_access_token_enc VARCHAR,
    square_status           VARCHAR NOT NULL DEFAULT 'not_connected',
    business_name           VARCHAR NOT NULL,
    business_type           VARCHAR,
    location_city           VARCHAR,
    location_state          VARCHAR,
    active                  BOOLEAN NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merchants_owner ON merchants(owner_privy_id);
CREATE INDEX idx_merchants_stripe ON merchants(stripe_connect_id) WHERE stripe_connect_id IS NOT NULL;
CREATE INDEX idx_merchants_square ON merchants(square_location_id) WHERE square_location_id IS NOT NULL;
