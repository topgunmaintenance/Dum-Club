-- Phase 10A: Offers & Orders tables for payments
-- Run in Supabase SQL Editor

-- Offers: structured items available for purchase
CREATE TABLE IF NOT EXISTS offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    price_usd NUMERIC(10,2) NOT NULL,
    offer_type TEXT NOT NULL CHECK (offer_type IN ('digital_service', 'physical_product')),
    delivery_info TEXT,
    token_discount_percent INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Orders: purchase records linked to offers
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID REFERENCES offers(id),
    project_id UUID REFERENCES projects(id),
    buyer_user_id TEXT NOT NULL,
    seller_user_id TEXT NOT NULL,
    amount_paid_usd NUMERIC(10,2),
    platform_fee_usd NUMERIC(10,2),
    seller_receives_usd NUMERIC(10,2),
    stripe_payment_intent_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    buyer_email TEXT,
    notes TEXT,
    token_discount_applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_offers_project_id ON offers(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_offer_id ON orders(offer_id);
CREATE INDEX IF NOT EXISTS idx_orders_project_id ON orders(project_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_pi ON orders(stripe_payment_intent_id);
