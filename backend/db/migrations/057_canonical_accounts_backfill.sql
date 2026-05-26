-- 057_canonical_accounts_backfill.sql
-- Phases C+D+E of the canonical-ownership migration.
--
-- WHY
-- ---
-- Tie the existing real business (Topgun Maintenance LLC) to Julian's
-- canonical account, attach both real storefronts (Topgun primary +
-- Silver Market Hub secondary) to that single LLC, and reconcile the
-- duplicate merchant rows: keep the LIVE-Stripe row (founding slot #1),
-- deactivate the dup (founding slot #2).
--
-- Founder direction:
--   - Canonical login owner:        jmero1@gmail.com
--   - Canonical legal business:     Topgun Maintenance LLC
--   - Business/legal email:         julian@topgunmaintenance.com
--   - Silver Market Hub:            secondary storefront under same LLC
--   - Keep LIVE Stripe (acct_1TRY4h1Q55Fqu9MS, $2 real revenue)
--   - Deactivate duplicate merchant; do not delete; leave Stripe acct
--     dormant; leave founding_slot_number for audit history
--   - Do not touch orders, payouts, payments, analytics, inventory, or
--     livestream history
--
-- WHAT THIS FILE DOES
-- -------------------
-- 11 row operations in total, all in ONE transaction:
--   1 UPDATE to business_profiles (set account_id, business_email, email_domain)
--   2 UPDATEs to projects (set account_id and business_profile_id on both storefronts)
--   2 UPDATEs to merchants (one keep, one deactivate)
-- All targets are addressed by primary key with defensive WHERE clauses
-- that double-check stripe_connect_id / business_name so an unexpected
-- prior state aborts the migration instead of silently corrupting rows.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- - Does not write to orders, offers, dum_transactions, redemptions,
--   purchase_proofs, merchant_analytics_events, ai_agent_*, auctions,
--   bookings, service_profiles, users, profiles, store_items, or any
--   token / livestream / popin / replay column.
-- - Does not modify legacy identity columns (projects.privy_id,
--   projects.owner_id, business_profiles.privy_id,
--   business_profiles.owner_privy_id, merchants.owner_privy_id).
--   These stay populated so the existing dashboard query keeps working
--   until 055_dashboard_account_lookup PR ships Phase G.
-- - Does not modify any Stripe Connect ID, status, plan_id, tier,
--   subscription_price_usd, platform_fee_percent, or
--   commission_rate_override on either merchant row.
-- - Does not modify founding_slot_number on the deactivated merchant
--   (per founder direction: preserve audit history).
-- - Does not soft-delete or archive any project.
-- - Does not touch the 58 demo/seed projects.
--
-- DEPENDENCIES
-- ------------
-- Requires 055 and 056 to have run. Reads accounts.id via lookup on
-- primary_email = 'jmero1@gmail.com'.
--
-- IDEMPOTENCY
-- -----------
-- Each UPDATE uses IS DISTINCT FROM (where appropriate) so re-running
-- against an already-converged database touches zero rows.
--
-- ROLLBACK
-- --------
-- See rollback/055_058_canonical_accounts_rollback.sql.

BEGIN;

-- Pre-flight: confirm the account exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'
  ) THEN
    RAISE EXCEPTION 'Account jmero1@gmail.com not found. Run 056 first.';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- Phase C: business_profiles backfill (Topgun Maintenance LLC, 1 row)
-- ----------------------------------------------------------------
-- Defensive: requires the row to still be named "Topgun Maintenance LLC"
-- and currently have account_id NULL and business_email NULL. If any of
-- those preconditions are violated, the row is skipped (zero updates),
-- which lets the migration run idempotently.
UPDATE public.business_profiles
   SET account_id     = (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'),
       business_email = 'julian@topgunmaintenance.com',
       email_domain   = 'topgunmaintenance.com',
       updated_at     = now()
 WHERE id            = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'
   AND business_name = 'Topgun Maintenance LLC'
   AND (account_id IS NULL OR business_email IS NULL);  -- idempotent guard

-- ----------------------------------------------------------------
-- Phase D: projects backfill — attach both storefronts to the LLC
-- ----------------------------------------------------------------
-- Topgun Maintenance LLC (primary storefront).
-- business_profile_id was already 'd6c40d05...' so that part is a no-op.
UPDATE public.projects
   SET account_id          = (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'),
       business_profile_id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab',
       updated_at          = now()
 WHERE id   = 'bc43652f-1426-4039-9086-a8be5d28d144'
   AND name = 'Topgun Maintenance LLC'
   AND account_id IS DISTINCT FROM
       (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com');

-- Silver Market Hub (secondary storefront, newly attached to same LLC).
UPDATE public.projects
   SET account_id          = (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'),
       business_profile_id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab',
       updated_at          = now()
 WHERE id   = '613d414c-d941-4f23-9ffe-cff41546fc01'
   AND name = 'Silver Market Hub'
   AND account_id IS DISTINCT FROM
       (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com');

-- ----------------------------------------------------------------
-- Phase E: merchants reconcile — keep LIVE Stripe, deactivate dup
-- ----------------------------------------------------------------
-- KEEP: merchant e8dfb42c — has LIVE Stripe acct_1TRY4h1Q55Fqu9MS,
-- founding slot #1, linked to business_profile via business_profile_id.
-- Defensive guard: refuse to update if the stripe_connect_id has
-- changed from the audit-time value.
UPDATE public.merchants
   SET account_id          = (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'),
       business_profile_id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'  -- no-op, already set
 WHERE id                = 'e8dfb42c-1134-48d3-8615-9ec5ac07e79e'
   AND stripe_connect_id = 'acct_1TRY4h1Q55Fqu9MS'
   AND account_id IS DISTINCT FROM
       (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com');

-- DEACTIVATE: merchant c898ae74 — duplicate, test-mode Stripe acct,
-- blocking founding slot #2. Stripe Connect ID is preserved (left
-- dormant per founder direction). founding_slot_number is preserved
-- per founder direction (audit history).
UPDATE public.merchants
   SET account_id          = (SELECT id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com'),
       active              = false,
       subscription_status = 'inactive',
       business_profile_id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'
 WHERE id                = 'c898ae74-e979-417e-8118-a9d5ef99b10c'
   AND stripe_connect_id = 'acct_1TG74OBqrR2Kx0BP'
   AND (active = true OR account_id IS NULL);  -- idempotent guard

-- ----------------------------------------------------------------
-- Post-flight sanity checks (raise on any unexpected state)
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_account_id           uuid;
  v_business_account_id  uuid;
  v_business_email       text;
  v_topgun_account_id    uuid;
  v_topgun_bp_id         uuid;
  v_silver_account_id    uuid;
  v_silver_bp_id         uuid;
  v_keep_active          boolean;
  v_keep_stripe          text;
  v_keep_account_id      uuid;
  v_dup_active           boolean;
  v_dup_stripe           text;
  v_dup_status           text;
  v_dup_slot             int;
BEGIN
  SELECT id INTO v_account_id FROM public.accounts WHERE primary_email = 'jmero1@gmail.com';

  -- business_profiles
  SELECT account_id, business_email
    INTO v_business_account_id, v_business_email
    FROM public.business_profiles WHERE id = 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab';
  IF v_business_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'business_profile account_id not set to Julian account';
  END IF;
  IF v_business_email <> 'julian@topgunmaintenance.com' THEN
    RAISE EXCEPTION 'business_email mismatch: got %', v_business_email;
  END IF;

  -- projects: Topgun
  SELECT account_id, business_profile_id INTO v_topgun_account_id, v_topgun_bp_id
    FROM public.projects WHERE id = 'bc43652f-1426-4039-9086-a8be5d28d144';
  IF v_topgun_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Topgun project account_id not set';
  END IF;
  IF v_topgun_bp_id IS DISTINCT FROM 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'::uuid THEN
    RAISE EXCEPTION 'Topgun project business_profile_id mismatch';
  END IF;

  -- projects: Silver Market Hub
  SELECT account_id, business_profile_id INTO v_silver_account_id, v_silver_bp_id
    FROM public.projects WHERE id = '613d414c-d941-4f23-9ffe-cff41546fc01';
  IF v_silver_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'Silver Market Hub project account_id not set';
  END IF;
  IF v_silver_bp_id IS DISTINCT FROM 'd6c40d05-7c63-47b9-8363-2d1dc835b7ab'::uuid THEN
    RAISE EXCEPTION 'Silver Market Hub project business_profile_id mismatch';
  END IF;

  -- merchants: keep row e8dfb42c
  SELECT active, stripe_connect_id, account_id
    INTO v_keep_active, v_keep_stripe, v_keep_account_id
    FROM public.merchants WHERE id = 'e8dfb42c-1134-48d3-8615-9ec5ac07e79e';
  IF v_keep_active <> true THEN
    RAISE EXCEPTION 'KEEP merchant is not active';
  END IF;
  IF v_keep_stripe <> 'acct_1TRY4h1Q55Fqu9MS' THEN
    RAISE EXCEPTION 'KEEP merchant stripe_connect_id mutated: got %', v_keep_stripe;
  END IF;
  IF v_keep_account_id IS DISTINCT FROM v_account_id THEN
    RAISE EXCEPTION 'KEEP merchant account_id not set';
  END IF;

  -- merchants: deactivated row c898ae74
  SELECT active, stripe_connect_id, subscription_status, founding_slot_number
    INTO v_dup_active, v_dup_stripe, v_dup_status, v_dup_slot
    FROM public.merchants WHERE id = 'c898ae74-e979-417e-8118-a9d5ef99b10c';
  IF v_dup_active <> false THEN
    RAISE EXCEPTION 'DUP merchant is still active';
  END IF;
  IF v_dup_stripe <> 'acct_1TG74OBqrR2Kx0BP' THEN
    RAISE EXCEPTION 'DUP merchant stripe_connect_id mutated: got %', v_dup_stripe;
  END IF;
  IF v_dup_status <> 'inactive' THEN
    RAISE EXCEPTION 'DUP merchant subscription_status not inactive: got %', v_dup_status;
  END IF;
  -- Founder direction: founding_slot_number preserved for audit history.
  IF v_dup_slot IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'DUP merchant founding_slot_number unexpectedly changed: got %', v_dup_slot;
  END IF;
END $$;

COMMIT;
