# NEXT_TASK.md
# Sprint 2 — Step 1

## Today's Single Task

Run the approved merchants table migration
and confirm the table exists with correct
structure before any other work begins.

## The Approved Migration SQL

CREATE TABLE IF NOT EXISTS merchants (
  id                      UUID PRIMARY KEY
                          DEFAULT gen_random_uuid(),
  owner_privy_id          TEXT NOT NULL UNIQUE,
  business_profile_id     UUID REFERENCES
                          business_profiles(id),
  founding_merchant       BOOLEAN NOT NULL DEFAULT true,
  subscription_tier       VARCHAR NOT NULL
                          DEFAULT 'founding',
  subscription_price_usd  DECIMAL(10,2) NOT NULL
                          DEFAULT 0,
  platform_fee_percent    DECIMAL(5,2) NOT NULL
                          DEFAULT 0,
  stripe_connect_id       VARCHAR,
  stripe_connect_status   VARCHAR NOT NULL
                          DEFAULT 'not_connected',
  square_location_id      VARCHAR,
  square_access_token_enc VARCHAR,
  square_status           VARCHAR NOT NULL
                          DEFAULT 'not_connected',
  business_name           VARCHAR NOT NULL,
  business_type           VARCHAR,
  location_city           VARCHAR,
  location_state          VARCHAR,
  notes                   TEXT,
  active                  BOOLEAN NOT NULL
                          DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL
                          DEFAULT NOW()
);

CREATE INDEX idx_merchants_owner
  ON merchants(owner_privy_id);
CREATE INDEX idx_merchants_stripe
  ON merchants(stripe_connect_id)
  WHERE stripe_connect_id IS NOT NULL;
CREATE INDEX idx_merchants_square
  ON merchants(square_location_id)
  WHERE square_location_id IS NOT NULL;

## How To Run It

Check how existing migrations run in this repo.
Find the migrations folder or runner script.
Use whatever pattern already exists.
Do not invent a new migration system.
Check last migration number — audit noted
migration 025 exists for webhook idempotency.
Name this file 026_merchants.sql or next number.

## What Done Looks Like

  Migration file in correct location
  Migration executed successfully
  Table confirmed:
    SELECT * FROM merchants LIMIT 1
    returns empty with no error
  All three indexes confirmed created
  Report: file path, execution result,
  confirmation query result

## What Not To Do

  Do not build signup endpoint yet
  Do not build any OAuth flows yet
  Do not touch any existing tables
  Do not touch any existing migration files
  Do not touch any backend routes
  This task is migration only

## One Task. Done Completely. Proven. Then Next.
