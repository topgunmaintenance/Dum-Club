-- 032_ai_agent_phase1.sql
-- AI Agent add-on: columns on merchants + new tables for phone numbers
-- and conversations.
-- Phase 1: manual toggle via ai_agent_enabled. Stripe billing in Phase 3.

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS ai_agent_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_agent_plan TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ai_agent_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS ai_agent_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- CHECK constraints added separately so IF NOT EXISTS on ADD COLUMN
-- doesn't collide with the constraint definition on re-runs.
DO $$ BEGIN
  ALTER TABLE merchants
    ADD CONSTRAINT merchants_ai_agent_plan_check
    CHECK (ai_agent_plan IN ('none','starter','pro','unlimited'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE merchants
    ADD CONSTRAINT merchants_ai_agent_status_check
    CHECK (ai_agent_status IN ('inactive','active','suspended','error'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN merchants.ai_agent_enabled IS
  'Phase 1: toggled manually by admin/owner. Phase 3: derived from Stripe subscription status.';
COMMENT ON COLUMN merchants.ai_agent_plan IS
  'none | starter ($199) | pro ($399) | unlimited ($499). Phase 1: set manually. Phase 3: set by Stripe webhook.';
COMMENT ON COLUMN merchants.ai_agent_status IS
  'inactive | active | suspended | error. Gates all agent endpoints and LLM calls.';
COMMENT ON COLUMN merchants.ai_agent_config IS
  'Validated against schemas/business_config.schema.json. Contains identity, scope, tools, channels, rewards, escalation, guardrails.';

-- Phone numbers: one active number per business.
CREATE TABLE IF NOT EXISTS ai_agent_phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  e164 TEXT NOT NULL UNIQUE,
  twilio_sid TEXT NOT NULL,
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_phone_business_active
  ON ai_agent_phone_numbers(business_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_phone_business
  ON ai_agent_phone_numbers(business_id);

-- Conversations: every voice call, SMS thread, and web chat session.
CREATE TABLE IF NOT EXISTS ai_agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('voice','sms','web')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  customer_identifier TEXT,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'booked','checkout_sent','handoff','info','abandoned','error'
  )),
  cost_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_business_time
  ON ai_agent_conversations(business_id, started_at DESC);

-- Tool call idempotency: prevents duplicate Stripe sessions and SMS
-- across restarts and multi-instance Vercel deploys.
CREATE TABLE IF NOT EXISTS ai_agent_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_idempotency_unique
  ON ai_agent_idempotency(business_id, tool_name, idempotency_key);

-- Auto-expire old idempotency records (optional cleanup job).
CREATE INDEX IF NOT EXISTS idx_ai_idempotency_created
  ON ai_agent_idempotency(created_at);

-- RLS: enabled for defense-in-depth. All API access uses the service role
-- key (which bypasses RLS). User-facing RLS policies require a mapping
-- between Privy IDs and Supabase auth.uid() that doesn't exist yet.
ALTER TABLE ai_agent_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agent_idempotency ENABLE ROW LEVEL SECURITY;
