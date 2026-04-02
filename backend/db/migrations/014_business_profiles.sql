-- Migration: Business profiles with verification
-- Run this in Supabase SQL Editor BEFORE deploying backend changes

CREATE TABLE IF NOT EXISTS business_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_privy_id TEXT NOT NULL,
    business_name TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    short_description TEXT,
    logo_url TEXT,
    website TEXT,
    contact_email TEXT,
    verification_status TEXT DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified')),
    verification_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(owner_privy_id)
);

-- Link projects to business profiles (optional, additive)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS business_profile_id UUID REFERENCES business_profiles(id);

CREATE INDEX IF NOT EXISTS idx_business_profiles_owner ON business_profiles (owner_privy_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_status ON business_profiles (verification_status);

-- Notes:
-- UNIQUE(owner_privy_id): one business profile per user for now
-- verification_status: unverified → pending (user requests) → verified (admin approves)
-- business_profile_id on projects: optional link, existing projects work without it
