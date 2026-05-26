-- 055_058_canonical_accounts_verify.sql
-- Read-only verification queries for migrations 055-058.
--
-- HOW TO USE
-- ----------
-- Run sections in order. Each section corresponds to one phase. Compare
-- the actual output against the "Expected:" comment above each query.
-- Any deviation means STOP and investigate before proceeding to the
-- next phase. Final section (8) simulates the post-Phase-G dashboard
-- query for every Julian Privy DID and must return both Topgun and
-- Silver Market Hub for every DID.
--
-- This script reads only; no rows are modified.

-- ================================================================
-- Section 1: Pre-migration baseline (run BEFORE migration 055)
-- ================================================================

-- Expected row counts (audit 2026-05-26): projects=60, merchants=2,
-- business_profiles=1, orders=45, users=9, profiles=1
SELECT 'pre/projects'          AS metric, COUNT(*)::text AS value FROM public.projects
UNION ALL SELECT 'pre/merchants',          COUNT(*)::text         FROM public.merchants
UNION ALL SELECT 'pre/business_profiles',  COUNT(*)::text         FROM public.business_profiles
UNION ALL SELECT 'pre/orders',             COUNT(*)::text         FROM public.orders
UNION ALL SELECT 'pre/users',              COUNT(*)::text         FROM public.users
UNION ALL SELECT 'pre/profiles',           COUNT(*)::text         FROM public.profiles
UNION ALL SELECT 'pre/merchant_analytics_events', COUNT(*)::text  FROM public.merchant_analytics_events;

-- Expected: orders.paid_count for the two target projects unchanged
-- before and after migration (15 for Silver Market Hub, 17 for Topgun)
SELECT p.id AS project_id, p.name, COUNT(o.id) AS total_orders,
       COUNT(o.id) FILTER (WHERE o.status='paid') AS paid_orders
  FROM public.projects p
  LEFT JOIN public.orders o ON o.project_id = p.id
 WHERE p.id IN ('bc43652f-1426-4039-9086-a8be5d28d144',
                '613d414c-d941-4f23-9ffe-cff41546fc01')
 GROUP BY p.id, p.name;

-- ================================================================
-- Section 2: Verify Phase A (after migration 055)
-- ================================================================

-- Expected: 2 rows (accounts, account_logins both exist)
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name IN ('accounts','account_logins')
 ORDER BY table_name;

-- Expected: both empty
SELECT 'accounts' AS t, COUNT(*) FROM public.accounts
UNION ALL SELECT 'account_logins', COUNT(*) FROM public.account_logins;

-- Expected: 3 rows showing nullable account_id columns
SELECT table_name, column_name, is_nullable, data_type
  FROM information_schema.columns
 WHERE table_schema='public' AND column_name='account_id'
   AND table_name IN ('projects','merchants','business_profiles')
 ORDER BY table_name;

-- Expected: 1 row showing the new FK constraint exists
SELECT constraint_name, table_name
  FROM information_schema.table_constraints
 WHERE constraint_schema='public'
   AND constraint_name='projects_business_profile_id_fkey';

-- Expected: 4 new indexes exist
SELECT indexname FROM pg_indexes
 WHERE schemaname='public'
   AND indexname IN ('idx_account_logins_account_id',
                     'idx_projects_account_id',
                     'idx_projects_business_profile_id',
                     'idx_merchants_account_id',
                     'idx_business_profiles_account_id')
 ORDER BY indexname;

-- Expected: row counts on existing tables unchanged from baseline
SELECT 'post-A/projects'         AS metric, COUNT(*)::text AS value FROM public.projects
UNION ALL SELECT 'post-A/merchants',        COUNT(*)::text         FROM public.merchants
UNION ALL SELECT 'post-A/business_profiles',COUNT(*)::text         FROM public.business_profiles
UNION ALL SELECT 'post-A/orders',           COUNT(*)::text         FROM public.orders;

-- ================================================================
-- Section 3: Verify Phase B (after migration 056)
-- ================================================================

-- Expected: exactly 1 row, primary_email=jmero1@gmail.com, display_name=Julian Mero
SELECT id, primary_email, display_name, created_at FROM public.accounts;

-- Expected: exactly 5 rows, all 5 Julian Privy DIDs mapped to the same account_id
SELECT al.privy_did, al.provider, al.linked_email, a.primary_email
  FROM public.account_logins al
  JOIN public.accounts a ON a.id = al.account_id
 ORDER BY al.linked_email NULLS LAST, al.privy_did;

-- Expected: all 5 logins share the same account_id (so DISTINCT count = 1)
SELECT COUNT(DISTINCT account_id) AS distinct_accounts FROM public.account_logins;

-- ================================================================
-- Section 4: Verify Phase C (after migration 057, business_profiles)
-- ================================================================

-- Expected:
--   account_id = <Julian's account_id from Section 3>
--   business_email = 'julian@topgunmaintenance.com'
--   email_domain = 'topgunmaintenance.com'
--   contact_email = 'julian@topgunmaintenance.com'  (UNCHANGED)
--   verification_status = 'verified'                  (UNCHANGED)
--   business_name = 'Topgun Maintenance LLC'          (UNCHANGED)
--   project_id = 'bc43652f-1426-4039-9086-a8be5d28d144' (UNCHANGED)
--   privy_id = 'seed:topgun-maintenance'             (UNCHANGED - legacy)
--   owner_privy_id = 'did:privy:cmnd6o13r02r40cl87mcwj9ya' (UNCHANGED - legacy)
SELECT id, business_name, business_email, email_domain, contact_email,
       account_id, verification_status, privy_id, owner_privy_id, project_id
  FROM public.business_profiles
 WHERE id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab';

-- ================================================================
-- Section 5: Verify Phase D (after migration 057, projects)
-- ================================================================

-- Expected for both rows:
--   account_id = <Julian's account_id>
--   business_profile_id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'
-- Expected UNCHANGED:
--   status = 'live'
--   view_count = 1313 (Topgun), 310 (Silver Market Hub)
--   is_archived = false, is_deleted = false
--   privy_id, owner_id (legacy identity columns unchanged)
SELECT id, name, status, account_id, business_profile_id, view_count,
       is_archived, is_deleted, owner_id, privy_id, wallet_address
  FROM public.projects
 WHERE id IN ('bc43652f-1426-4039-9086-a8be5d28d144',
              '613d414c-d941-4f23-9ffe-cff41546fc01')
 ORDER BY name;

-- Critical: order counts on these two projects MUST be unchanged
-- from the pre-migration baseline. Expected: 17 for Topgun, 15 for Silver
SELECT p.name, COUNT(o.id) AS total_orders,
       COUNT(o.id) FILTER (WHERE o.status='paid') AS paid_orders,
       COALESCE(SUM(o.amount_paid_usd) FILTER (WHERE o.status='paid'), 0) AS paid_total_usd
  FROM public.projects p
  LEFT JOIN public.orders o ON o.project_id = p.id
 WHERE p.id IN ('bc43652f-1426-4039-9086-a8be5d28d144',
                '613d414c-d941-4f23-9ffe-cff41546fc01')
 GROUP BY p.name;

-- ================================================================
-- Section 6: Verify Phase E (after migration 057, merchants)
-- ================================================================

-- Expected:
--   e8dfb42c (KEEP):  active=true,  status='active',   stripe='acct_1TRY4h1Q55Fqu9MS', slot=1, account_id=<Julian>
--   c898ae74 (DUP):   active=false, status='inactive', stripe='acct_1TG74OBqrR2Kx0BP', slot=2, account_id=<Julian>
-- UNCHANGED from baseline:
--   stripe_connect_id (both)
--   stripe_connect_status (verified / connected)
--   founding_slot_number (1 / 2 — preserved per founder direction)
--   subscription_tier (founding / founding)
--   plan_id (starter / starter)
--   founding_merchant (true / true)
SELECT id, business_name, account_id, active, subscription_status,
       stripe_connect_id, stripe_connect_status, founding_slot_number,
       subscription_tier, plan_id, founding_merchant, owner_privy_id
  FROM public.merchants
 ORDER BY founding_slot_number;

-- Confirm ai_agent_* tables still point at unchanged merchant IDs.
-- Expected: same row counts as pre-migration (11 conversations, 1 phone, 0 idempotency)
SELECT 'ai_agent_conversations' AS t, COUNT(*) FROM public.ai_agent_conversations WHERE business_id IN
        ('e8dfb42c-1134-48d3-8615-9ec5ac07e79e','c898ae74-e979-417e-8118-a9d5ef99b10c')
UNION ALL
SELECT 'ai_agent_phone_numbers', COUNT(*) FROM public.ai_agent_phone_numbers WHERE business_id IN
        ('e8dfb42c-1134-48d3-8615-9ec5ac07e79e','c898ae74-e979-417e-8118-a9d5ef99b10c')
UNION ALL
SELECT 'ai_agent_idempotency',   COUNT(*) FROM public.ai_agent_idempotency   WHERE business_id IN
        ('e8dfb42c-1134-48d3-8615-9ec5ac07e79e','c898ae74-e979-417e-8118-a9d5ef99b10c');

-- ================================================================
-- Section 7: Verify Phase F (after migration 058)
-- ================================================================

-- Expected: 1 row, the partial unique index exists
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname='public'
   AND indexname='ux_merchants_one_active_per_business';

-- Expected: exactly 1 active merchant for the Topgun business_profile
SELECT business_profile_id,
       COUNT(*) FILTER (WHERE active=true)  AS active_count,
       COUNT(*) FILTER (WHERE active=false) AS inactive_count
  FROM public.merchants
 WHERE business_profile_id IS NOT NULL
 GROUP BY business_profile_id;

-- ================================================================
-- Section 8: Simulate dashboard query for every Julian Privy DID
-- (This is what Phase G's backend rewrite will execute.)
-- ================================================================

-- Expected: 5 Privy DIDs x 2 projects = 10 rows
-- Both Topgun Maintenance LLC and Silver Market Hub must appear for
-- every Julian login session.
WITH julian AS (
  SELECT id AS account_id FROM public.accounts WHERE primary_email='jmero1@gmail.com'
)
SELECT al.privy_did,
       al.linked_email,
       p.id   AS project_id,
       p.name AS project_name,
       p.status,
       p.is_deleted
  FROM public.account_logins al
  JOIN julian j               ON al.account_id = j.account_id
  JOIN public.projects p      ON p.account_id  = j.account_id AND p.is_deleted = false
 ORDER BY al.linked_email NULLS LAST, p.created_at DESC;

-- Sanity: no orders moved off the two target projects
-- Expected: 17 / 15 (unchanged from baseline)
SELECT p.name, COUNT(o.id) AS total_orders
  FROM public.projects p
  LEFT JOIN public.orders o ON o.project_id = p.id
 WHERE p.id IN ('bc43652f-1426-4039-9086-a8be5d28d144',
                '613d414c-d941-4f23-9ffe-cff41546fc01')
 GROUP BY p.name;

-- Sanity: every Stripe Connect ID + status preserved
-- Expected: 2 rows, both stripe_connect_id columns unchanged from baseline
SELECT id, stripe_connect_id, stripe_connect_status
  FROM public.merchants
 ORDER BY founding_slot_number;

-- ================================================================
-- Section 9: Confirm legacy reads still work (transition safety)
-- ================================================================

-- The current dashboard (pre-Phase-G) filters by projects.privy_id.
-- This query simulates what THAT older dashboard sees for jmero1's DID.
-- Expected: at least 1 row (Silver Market Hub + any other ai_app rows
-- with the same privy_id). Topgun appears only when logged in via the
-- anonymous cmp1h896l DID. Whatever the row count, it must be UNCHANGED
-- from the pre-migration value — proving 055-058 did not affect the
-- legacy code path.
SELECT id, name, status, privy_id
  FROM public.projects
 WHERE privy_id = 'did:privy:cmn4scnrm01ik0cjm4euetris'
   AND is_deleted = false
 ORDER BY created_at DESC;

SELECT id, name, status, privy_id
  FROM public.projects
 WHERE privy_id = 'did:privy:cmp1h896l005a0claq31qybx7'
   AND is_deleted = false
 ORDER BY created_at DESC;
