-- 028_outreach.sql
-- Manual merchant outreach layer — proactive cold outreach.
--
-- This is DISTINCT from the existing merchant_outreach_queue table
-- (created upstream of this migration) which is reactive — queued
-- automatically after a customer submits a verified purchase proof
-- for an off-platform business. That flow is driven by the
-- merchant_outreach_queue_enabled feature flag and is keyed on
-- external_business_id.
--
-- The tables below power a completely different UX: an admin manually
-- enters leads (contact + business name), sends email outreach from
-- a hand-picked template, and tracks follow-ups. The two systems can
-- co-exist — a merchant may end up with rows in both.

CREATE TABLE IF NOT EXISTS outreach_leads (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact            TEXT NOT NULL,              -- typically an email; free-form for other channels later
    business_name      VARCHAR,
    source             VARCHAR NOT NULL DEFAULT 'manual',  -- allowed: manual | import | referral | event
    status             VARCHAR NOT NULL DEFAULT 'new',     -- allowed: new | contacted | replied | onboarded | bounced | unsubscribed
    last_contacted_at  TIMESTAMPTZ,
    unsubscribed_at    TIMESTAMPTZ,                -- set when the lead hits the unsubscribe endpoint; CAN-SPAM audit trail
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent lead creation: no two leads with the same contact
-- (case-insensitive). Prevents accidental duplicate outreach to the
-- same person if an admin pastes the same email twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_leads_contact_lower
    ON outreach_leads (LOWER(contact));

CREATE INDEX IF NOT EXISTS idx_outreach_leads_status
    ON outreach_leads (status);

CREATE TABLE IF NOT EXISTS outreach_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id     UUID NOT NULL REFERENCES outreach_leads(id) ON DELETE CASCADE,
    subject     VARCHAR NOT NULL,                  -- captured separately from body for audit trail
    message     TEXT NOT NULL,                     -- plain-text body as rendered
    template_key VARCHAR NOT NULL DEFAULT 'initial', -- 'initial' | 'followup_day2' | 'followup_day5' | 'followup_day10'
    channel     VARCHAR NOT NULL DEFAULT 'email',
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    send_ok     BOOLEAN NOT NULL DEFAULT true,
    send_error  TEXT                               -- populated when Resend reports failure; null on success
);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_lead
    ON outreach_messages (lead_id, sent_at DESC);
