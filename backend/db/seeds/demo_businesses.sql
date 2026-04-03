-- DUM Club Demo Seed Data
-- Run in Supabase SQL Editor to populate 3 polished demo businesses
-- with offers and simulated orders for hackathon demo.
--
-- IMPORTANT: Replace 'OWNER_PRIVY_ID' below with your actual admin
-- Privy ID (e.g., 'did:privy:abc123...'). Run this query first to find it:
--   SELECT privy_id FROM users LIMIT 5;

-- ════════════════════════════════════════════════════════════════
-- CONFIG: Set your owner ID here
-- ════════════════════════════════════════════════════════════════
DO $$
DECLARE
  owner_privy TEXT := (SELECT privy_id FROM users ORDER BY created_at ASC LIMIT 1);
  owner_uuid  TEXT := (SELECT id::TEXT FROM profiles ORDER BY created_at ASC LIMIT 1);

  -- Project IDs (generated)
  proj_wash   UUID := gen_random_uuid();
  proj_growth UUID := gen_random_uuid();
  proj_date   UUID := gen_random_uuid();

  -- Offer IDs
  offer_basic_wash   UUID := gen_random_uuid();
  offer_full_detail  UUID := gen_random_uuid();
  offer_monthly_wash UUID := gen_random_uuid();
  offer_hooks        UUID := gen_random_uuid();
  offer_templates    UUID := gen_random_uuid();
  offer_standard_box UUID := gen_random_uuid();
  offer_premium_box  UUID := gen_random_uuid();

  -- Simulated buyer
  buyer_id TEXT := 'demo-buyer-001';

  ts_now TIMESTAMPTZ := NOW();
BEGIN

-- ════════════════════════════════════════════════════════════════
-- BUSINESS 1: Sparkle Pro Mobile Wash
-- ════════════════════════════════════════════════════════════════
INSERT INTO projects (
  id, name, title, description, template_type, category,
  token_name, token_symbol, token_supply, token_decimals,
  token_utility, status, review_status, token_status,
  owner_id, privy_id, created_at
) VALUES (
  proj_wash,
  'Sparkle Pro Mobile Wash',
  'Sparkle Pro Mobile Wash',
  'Premium mobile car detailing that comes to you. Professional-grade ceramic coatings, interior deep cleans, and monthly maintenance plans for busy professionals who want their car looking showroom-ready without leaving home.',
  'ai_app', 'services',
  'Sparkle Pro', 'SPWASH', 21000000, 9,
  'Customers earn rewards with every wash and unlock priority scheduling and exclusive seasonal packages.',
  'live', 'approved', 'trading_live',
  owner_uuid, owner_privy, ts_now - INTERVAL '5 days'
) ON CONFLICT (id) DO NOTHING;

-- Offers
INSERT INTO offers (id, project_id, title, description, price_usd, offer_type, token_discount_percent, unlimited_inventory, quantity_sold, is_active, created_at)
VALUES
  (offer_basic_wash, proj_wash, 'Basic Exterior Wash', 'Full exterior hand wash with tire shine and window cleaning. Takes about 30 minutes at your location.', 25.00, 'digital_service', 10, TRUE, 8, TRUE, ts_now - INTERVAL '5 days'),
  (offer_full_detail, proj_wash, 'Full Interior + Exterior Detail', 'Complete inside-out detail including leather conditioning, carpet shampoo, ceramic spray coating, and engine bay clean.', 120.00, 'digital_service', 10, TRUE, 4, TRUE, ts_now - INTERVAL '5 days'),
  (offer_monthly_wash, proj_wash, 'Monthly Maintenance Plan', 'Two washes per month with priority scheduling and 10% off all add-on services. Cancel anytime.', 60.00, 'digital_service', 10, TRUE, 3, TRUE, ts_now - INTERVAL '4 days')
ON CONFLICT (id) DO NOTHING;

-- Simulated orders for Business 1
INSERT INTO orders (id, offer_id, project_id, buyer_user_id, seller_user_id, amount_paid_usd, platform_fee_usd, seller_receives_usd, status, created_at, updated_at)
VALUES
  (gen_random_uuid(), offer_basic_wash, proj_wash, buyer_id, COALESCE(owner_uuid, 'demo'), 25.00, 1.75, 23.25, 'paid', ts_now - INTERVAL '4 days', ts_now - INTERVAL '4 days'),
  (gen_random_uuid(), offer_basic_wash, proj_wash, 'demo-buyer-002', COALESCE(owner_uuid, 'demo'), 25.00, 1.75, 23.25, 'fulfilled', ts_now - INTERVAL '3 days', ts_now - INTERVAL '3 days'),
  (gen_random_uuid(), offer_full_detail, proj_wash, 'demo-buyer-003', COALESCE(owner_uuid, 'demo'), 120.00, 8.40, 111.60, 'paid', ts_now - INTERVAL '2 days', ts_now - INTERVAL '2 days'),
  (gen_random_uuid(), offer_monthly_wash, proj_wash, buyer_id, COALESCE(owner_uuid, 'demo'), 60.00, 4.20, 55.80, 'paid', ts_now - INTERVAL '1 day', ts_now - INTERVAL '1 day'),
  (gen_random_uuid(), offer_basic_wash, proj_wash, 'demo-buyer-004', COALESCE(owner_uuid, 'demo'), 25.00, 1.75, 23.25, 'fulfilled', ts_now - INTERVAL '6 hours', ts_now - INTERVAL '6 hours');


-- ════════════════════════════════════════════════════════════════
-- BUSINESS 2: GrowthKit — Instagram Growth Toolkit
-- ════════════════════════════════════════════════════════════════
INSERT INTO projects (
  id, name, title, description, template_type, category,
  token_name, token_symbol, token_supply, token_decimals,
  token_utility, status, review_status, token_status,
  owner_id, privy_id, created_at
) VALUES (
  proj_growth,
  'GrowthKit',
  'GrowthKit — Instagram Growth Toolkit',
  'Done-for-you Instagram growth resources for creators, coaches, and small businesses. Viral hook templates, content calendars, and engagement strategies that actually work — tested across 200+ accounts.',
  'ai_app', 'digital',
  'GrowthKit', 'GRWKIT', 21000000, 9,
  'Supporters get early access to new template drops, exclusive strategy sessions, and priority support.',
  'live', 'approved', 'trading_live',
  owner_uuid, owner_privy, ts_now - INTERVAL '3 days'
) ON CONFLICT (id) DO NOTHING;

-- Offers
INSERT INTO offers (id, project_id, title, description, price_usd, offer_type, token_discount_percent, unlimited_inventory, quantity_sold, is_active, created_at)
VALUES
  (offer_hooks, proj_growth, '50 Viral Hooks Pack', 'Copy-and-paste hooks proven to stop the scroll. Organized by niche: fitness, business, lifestyle, food, and tech. Updated monthly.', 19.00, 'digital_service', 10, TRUE, 12, TRUE, ts_now - INTERVAL '3 days'),
  (offer_templates, proj_growth, 'Content Calendar + Templates', '30-day content calendar with 60 post templates, 20 story frameworks, and a Reels script library. Includes Canva templates.', 49.00, 'digital_service', 10, TRUE, 6, TRUE, ts_now - INTERVAL '3 days')
ON CONFLICT (id) DO NOTHING;

-- Simulated orders for Business 2
INSERT INTO orders (id, offer_id, project_id, buyer_user_id, seller_user_id, amount_paid_usd, platform_fee_usd, seller_receives_usd, status, created_at, updated_at)
VALUES
  (gen_random_uuid(), offer_hooks, proj_growth, buyer_id, COALESCE(owner_uuid, 'demo'), 19.00, 1.33, 17.67, 'paid', ts_now - INTERVAL '2 days 18 hours', ts_now - INTERVAL '2 days 18 hours'),
  (gen_random_uuid(), offer_hooks, proj_growth, 'demo-buyer-005', COALESCE(owner_uuid, 'demo'), 19.00, 1.33, 17.67, 'fulfilled', ts_now - INTERVAL '2 days', ts_now - INTERVAL '2 days'),
  (gen_random_uuid(), offer_templates, proj_growth, 'demo-buyer-002', COALESCE(owner_uuid, 'demo'), 49.00, 3.43, 45.57, 'paid', ts_now - INTERVAL '1 day 12 hours', ts_now - INTERVAL '1 day 12 hours'),
  (gen_random_uuid(), offer_hooks, proj_growth, 'demo-buyer-006', COALESCE(owner_uuid, 'demo'), 19.00, 1.33, 17.67, 'paid', ts_now - INTERVAL '8 hours', ts_now - INTERVAL '8 hours');


-- ════════════════════════════════════════════════════════════════
-- BUSINESS 3: Date Night Box Co.
-- ════════════════════════════════════════════════════════════════
INSERT INTO projects (
  id, name, title, description, template_type, category,
  token_name, token_symbol, token_supply, token_decimals,
  token_utility, status, review_status, token_status,
  owner_id, privy_id, created_at
) VALUES (
  proj_date,
  'Date Night Box Co.',
  'Date Night Box Co.',
  'Curated date night experiences delivered to your door. Each box includes activities, snacks, a playlist, and everything you need for a memorable evening — no planning required. Perfect for couples who are tired of "what do you want to do tonight?"',
  'ai_app', 'lifestyle',
  'DateNight', 'DNBOX', 21000000, 9,
  'Supporters get first access to seasonal limited-edition boxes and exclusive couples challenges.',
  'live', 'approved', 'trading_live',
  owner_uuid, owner_privy, ts_now - INTERVAL '4 days'
) ON CONFLICT (id) DO NOTHING;

-- Offers
INSERT INTO offers (id, project_id, title, description, price_usd, offer_type, token_discount_percent, unlimited_inventory, quantity_sold, is_active, created_at)
VALUES
  (offer_standard_box, proj_date, 'Standard Date Night Box', 'One curated date night experience with activities, snacks, conversation cards, and a custom playlist. Themes rotate monthly.', 39.00, 'physical_product', 10, TRUE, 7, TRUE, ts_now - INTERVAL '4 days'),
  (offer_premium_box, proj_date, 'Premium Experience Box', 'Everything in Standard plus premium add-ons: wine pairing guide, spa kit, photo challenge cards, and a surprise gift. The ultimate date night.', 79.00, 'physical_product', 10, TRUE, 3, TRUE, ts_now - INTERVAL '4 days')
ON CONFLICT (id) DO NOTHING;

-- Simulated orders for Business 3
INSERT INTO orders (id, offer_id, project_id, buyer_user_id, seller_user_id, amount_paid_usd, platform_fee_usd, seller_receives_usd, status, created_at, updated_at)
VALUES
  (gen_random_uuid(), offer_standard_box, proj_date, buyer_id, COALESCE(owner_uuid, 'demo'), 39.00, 2.73, 36.27, 'fulfilled', ts_now - INTERVAL '3 days 6 hours', ts_now - INTERVAL '3 days 6 hours'),
  (gen_random_uuid(), offer_premium_box, proj_date, 'demo-buyer-007', COALESCE(owner_uuid, 'demo'), 79.00, 5.53, 73.47, 'paid', ts_now - INTERVAL '2 days', ts_now - INTERVAL '2 days'),
  (gen_random_uuid(), offer_standard_box, proj_date, 'demo-buyer-003', COALESCE(owner_uuid, 'demo'), 39.00, 2.73, 36.27, 'paid', ts_now - INTERVAL '1 day', ts_now - INTERVAL '1 day'),
  (gen_random_uuid(), offer_standard_box, proj_date, 'demo-buyer-008', COALESCE(owner_uuid, 'demo'), 39.00, 2.73, 36.27, 'fulfilled', ts_now - INTERVAL '4 hours', ts_now - INTERVAL '4 hours');


-- ════════════════════════════════════════════════════════════════
-- SEED DUM TRANSACTIONS (platform activity)
-- ════════════════════════════════════════════════════════════════
INSERT INTO dum_transactions (privy_id, amount, reason, reference_id, balance_after, created_at)
VALUES
  (owner_privy, 25, 'launch_bonus', proj_wash::TEXT, 75, ts_now - INTERVAL '5 days'),
  (owner_privy, 25, 'launch_bonus', proj_growth::TEXT, 100, ts_now - INTERVAL '3 days'),
  (owner_privy, 25, 'launch_bonus', proj_date::TEXT, 125, ts_now - INTERVAL '4 days'),
  ('demo-buyer-001', 2, 'purchase_reward', offer_basic_wash::TEXT, 52, ts_now - INTERVAL '4 days'),
  ('demo-buyer-002', 2, 'purchase_reward', offer_basic_wash::TEXT, 52, ts_now - INTERVAL '3 days'),
  ('demo-buyer-003', 2, 'purchase_reward', offer_full_detail::TEXT, 52, ts_now - INTERVAL '2 days'),
  ('demo-buyer-005', 2, 'purchase_reward', offer_hooks::TEXT, 52, ts_now - INTERVAL '2 days'),
  ('demo-buyer-002', 2, 'purchase_reward', offer_templates::TEXT, 54, ts_now - INTERVAL '1 day 12 hours'),
  ('demo-buyer-007', 2, 'purchase_reward', offer_premium_box::TEXT, 52, ts_now - INTERVAL '2 days'),
  ('demo-buyer-003', 2, 'purchase_reward', offer_standard_box::TEXT, 54, ts_now - INTERVAL '1 day'),
  ('demo-buyer-008', 2, 'purchase_reward', offer_standard_box::TEXT, 52, ts_now - INTERVAL '4 hours')
ON CONFLICT DO NOTHING;


-- ════════════════════════════════════════════════════════════════
-- SEED MARKET STATE (so project pages show activity)
-- ════════════════════════════════════════════════════════════════
INSERT INTO project_market_state (project_id, price, market_cap, volume_24h, circulating_supply)
VALUES
  (proj_wash, 0.001, 21000, 150, 21000000),
  (proj_growth, 0.001, 21000, 85, 21000000),
  (proj_date, 0.001, 21000, 120, 21000000)
ON CONFLICT (project_id) DO UPDATE SET
  price = EXCLUDED.price,
  market_cap = EXCLUDED.market_cap,
  volume_24h = EXCLUDED.volume_24h;

RAISE NOTICE 'Seed complete: 3 businesses, 7 offers, 13 orders, 11 DUM transactions';
END $$;
