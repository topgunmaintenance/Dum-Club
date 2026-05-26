-- 056_canonical_accounts_seed.sql
-- Phase B of the canonical-ownership migration.
--
-- WHY
-- ---
-- Insert the canonical account row for Julian Mero (founder, founding
-- merchant #1) and map all five known Privy DIDs to it. After this
-- migration:
--
--   accounts (1 row):
--     primary_email='jmero1@gmail.com', display_name='Julian Mero'
--
--   account_logins (5 rows):
--     did:privy:cmn4scnrm01ik0cjm4euetris  google  jmero1@gmail.com
--     did:privy:cmnd6o13r02r40cl87mcwj9ya  wallet  julian@topgunmaintenance.com
--     did:privy:cmnxircnw00960bl8nm7ipa90  email   julian@dum.club
--     did:privy:cmp1lsq7p01fr0cjy0dk8r90h  email   julian@dum.club
--     did:privy:cmp1h896l005a0claq31qybx7  google  NULL  (anonymous Topgun session)
--
-- The primary_email is jmero1@gmail.com per founder direction: that is
-- the address Julian logs in with. The business email (LLC layer,
-- julian@topgunmaintenance.com) is set on business_profiles in 057.
--
-- DEPENDENCIES
-- ------------
-- Requires 055_canonical_accounts_schema.sql to have run.
-- Required by 057_canonical_accounts_backfill.sql (which reads
-- accounts.id WHERE primary_email='jmero1@gmail.com').
--
-- IDEMPOTENCY
-- -----------
-- The accounts row uses ON CONFLICT (primary_email) DO NOTHING so a
-- re-run does not duplicate the account. Each account_logins row uses
-- ON CONFLICT (privy_did) DO NOTHING. Re-running this file touches zero
-- rows on a second pass.
--
-- ROLLBACK
-- --------
-- See backend/db/migrations/rollback/055_058_canonical_accounts_rollback.sql.
-- DELETEs 5 account_logins rows then 1 accounts row.

BEGIN;

-- ----------------------------------------------------------------
-- 1. Insert Julian's canonical account
-- ----------------------------------------------------------------
INSERT INTO public.accounts (primary_email, display_name)
VALUES ('jmero1@gmail.com', 'Julian Mero')
ON CONFLICT (primary_email) DO NOTHING;

-- ----------------------------------------------------------------
-- 2. Insert the five Privy DID logins for Julian
-- ----------------------------------------------------------------
WITH julian AS (
  SELECT id AS account_id
    FROM public.accounts
   WHERE primary_email = 'jmero1@gmail.com'
)
INSERT INTO public.account_logins (account_id, privy_did, provider, linked_email)
SELECT julian.account_id, x.privy_did, x.provider, x.linked_email
  FROM julian, (VALUES
    ('did:privy:cmn4scnrm01ik0cjm4euetris', 'google', 'jmero1@gmail.com'),
    ('did:privy:cmnd6o13r02r40cl87mcwj9ya', 'wallet', 'julian@topgunmaintenance.com'),
    ('did:privy:cmnxircnw00960bl8nm7ipa90', 'email',  'julian@dum.club'),
    ('did:privy:cmp1lsq7p01fr0cjy0dk8r90h', 'email',  'julian@dum.club'),
    ('did:privy:cmp1h896l005a0claq31qybx7', 'google', NULL)
  ) AS x(privy_did, provider, linked_email)
ON CONFLICT (privy_did) DO NOTHING;

-- ----------------------------------------------------------------
-- 3. Sanity check (raises if either insert was unexpectedly empty)
-- ----------------------------------------------------------------
DO $$
DECLARE
  v_account_count int;
  v_logins_count  int;
BEGIN
  SELECT COUNT(*) INTO v_account_count FROM public.accounts WHERE primary_email = 'jmero1@gmail.com';
  IF v_account_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 accounts row for jmero1@gmail.com, found %', v_account_count;
  END IF;

  SELECT COUNT(*) INTO v_logins_count
    FROM public.account_logins al
    JOIN public.accounts a ON a.id = al.account_id
   WHERE a.primary_email = 'jmero1@gmail.com';
  IF v_logins_count < 5 THEN
    RAISE EXCEPTION 'Expected 5 account_logins rows for Julian, found %', v_logins_count;
  END IF;
END $$;

COMMIT;
