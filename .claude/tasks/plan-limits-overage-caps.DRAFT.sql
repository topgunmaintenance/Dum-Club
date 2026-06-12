-- DRAFT — DO NOT APPLY. plan_limits caps, M=3.0 + overage posture.
-- Alternative to plan-limits-interim-caps.DRAFT.sql (M=1.0 posture).
-- Lives in .claude/tasks/ (NOT backend/db/migrations/) so no tooling
-- can pick it up. Apply only via the normal migration gate, and ONLY
-- once the PRECONDITION below is true.
--
-- PRECONDITION (hard gate): overage auto-billing is LIVE and
-- collecting (see .claude/tasks/overage-auto-billing.md). Without it
-- this posture is the underwater one: -$36/-$111/-$151 worst case
-- per merchant-month (see the interim draft).
--
-- ASSUMPTIONS:
--   c = $0.10/viewer-hour IVS Real-Time list price
--       (merchant_limits.py:262-268) - CONFIRM real rate in AWS.
--   Stripe net on the subscription invoice = price*0.971 - $0.30
--       (card assumption) - CONFIRM Stripe Billing fees.
--   Overage bills every metered vh above included_vh at
--       plan_limits.overage_rate (0.13/0.12/0.10).
--   No-double-bill netting keeps revenue >= overage_owed: platform
--       collects max(sales_fee, overage), never less than overage.
--
-- FORMULA:
--   profit(T) = net_sub + r*(T - vh_inc) - c*T
--             = (net_sub - c*vh_inc) + (r - c)*(T - vh_inc)
--   With r >= c on every self-serve tier, profit is NON-DECREASING
--   in usage T. The viewer cap is therefore NOT a profitability
--   constraint under this posture - any max_concurrent stays
--   profitable. Floor profit (zero overage usage):
--     starter  37.57 - 25.00  = +$12.57
--     growth   95.83 - 70.00  = +$25.83
--     pro     290.03 - 150.00 = +$140.03
--
-- P&L AT THE ADVERTISED CEILING (M=3.0, worst case
-- T = 3*vh_inc + mc*1h*streams, in-flight overshoot included):
--   tier     T(vh)   cost     overage rev   net sub   profit
--   starter  1,000   $100.00   $97.50        $37.57   +$35.07
--   growth   2,700   $270.00  $240.00        $95.83   +$65.83
--   pro     10,500 $1,050.00  $900.00       $290.03  +$140.03
--
-- VERDICT: 250 / 600 / 2000 are all safe to keep advertising.
--
-- REAL CONSTRAINT AT M=3.0 - COLLECTION RISK, not margin: the
-- platform fronts the AWS spend and recovers it on the overage
-- invoice at period close. Worst-case receivable per merchant-
-- month: starter $97.50 / growth $240 / pro $900. If an overage
-- invoice never collects (card failure, churn, dispute), max
-- cash loss = cost - net_sub: starter $62 / growth $174 / pro
-- $760. Mitigations: no-double-bill nets against sales fees the
-- platform already holds (application_fee_amount), and the 3x
-- hard block bounds the credit line. Decide whether pro's $900
-- receivable ceiling is acceptable or whether to pair this with
-- a payment-method-on-file requirement before high-vh streaming.
--
-- NOTE: these are EXACTLY the migration 049 seed values. If the
-- interim (M=1.0) draft was never applied, PROD already holds
-- these numbers and this file is a no-op assertion; it exists so
-- the M=3.0 posture has an explicit, reviewable artifact and a
-- documented precondition.

BEGIN;

UPDATE plan_limits
   SET max_concurrent        = 250,
       hard_block_multiplier = 3.0,
       updated_at            = now()
 WHERE plan_id = 'starter';

UPDATE plan_limits
   SET max_concurrent        = 600,
       hard_block_multiplier = 3.0,
       updated_at            = now()
 WHERE plan_id = 'growth';

UPDATE plan_limits
   SET max_concurrent        = 2000,
       hard_block_multiplier = 3.0,
       updated_at            = now()
 WHERE plan_id = 'pro';

-- business / enterprise untouched (NULL caps = per-contract).
-- CAUTION: enterprise overage_rate is $0.08 < c=$0.10 - marginal
-- overage LOSES $0.02/vh by design; size the contracted base
-- accordingly. Do not extend the "any cap is profitable" claim
-- to enterprise.

COMMIT;
