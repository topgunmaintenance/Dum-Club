-- DRAFT — DO NOT APPLY. plan_limits interim cost caps.
-- Status: proposal only. Lives in .claude/tasks/ (NOT backend/db/
-- migrations/) precisely so no migration tooling can pick it up.
-- Apply only after Julian's explicit gated go, as a numbered
-- migration through the normal migration gate.
--
-- WHY: with overage billing manual-only (admin.py:48-53, nothing
-- scheduled), every self-serve tier is underwater at its 3x hard-
-- block ceiling at the code's $0.10/viewer-hour IVS cost basis
-- (merchant_limits.py:262-268): Starter -$36, Growth -$111,
-- Pro -$151 worst case per merchant-month. These caps make the
-- worst case profitable with ZERO overage revenue.
--
-- FORMULA (worst case bounded by enforcement as built):
--   cost_max = c * (included_vh * M  +  max_concurrent * D * S)
--     c = $0.10/vh (IVS list price assumption - CONFIRM in AWS)
--     M = hard_block_multiplier
--     D = 1h max stream duration (live_limits.py:13)
--     S = max_concurrent_streams
--   The mc*D*S term is in-flight overshoot: usage lands in
--   merchant_monthly_usage only at stream END, so a stream started
--   just under the block can run one full hour at full viewers.
--   Solve: cost_max <= 0.9 * stripe_net(price), included_vh kept
--   as advertised, M >= 1.0 (ck_block_mult CHECK).
--
-- PER-TIER P&L AT THE PROPOSED CAP (zero overage collected):
--   tier     price  net($)   caps            worst vh  cost   margin
--   starter   $39   37.57   mc 80,  M 1.0      330    $33.00  +$4.57
--   growth    $99   95.83   mc 150, M 1.0      850    $85.00  +$10.83
--   pro      $299  290.03   mc 350, M 1.0     2550   $255.00  +$35.03
--   (break-even mc at M=1.0 for reference: 125 / 258 / 466)
--
-- TRADE-OFFS / FLAGS:
--   1. M=1.0 eliminates the overage band entirely - Stream 6
--      revenue is $0 by construction. This is the interim posture
--      until overage-auto-billing ships; then restore M=3.0 and
--      raise max_concurrent (every overage hour bills at >= cost:
--      0.13/0.12/0.10 vs $0.10).
--   2. DOCTRINE CONFLICT: CLAUDE.md s3 advertises concurrent
--      ceilings 250/600/2000. Adopting these caps requires a
--      doctrine update in the same change - do not let copy and
--      enforcement disagree.
--   3. business/enterprise: no UPDATE here (caps are NULL =
--      per-contract). Contract guardrail at M=1.0, zero overage
--      collection: contracted_vh + mc*S <= 4,359 vh (Business
--      $499) / 17,460 vh (Enterprise $2,000) for the same 10%-
--      buffered guarantee at c=$0.10.
--   4. Confirm from dashboards before applying: real AWS IVS
--      per-participant-minute rate (region, host minutes, audio
--      vs video), and Stripe's actual take on subscription
--      invoices (2.9%+$0.30 card assumption used here; Stripe
--      Billing plan fees may differ).

BEGIN;

UPDATE plan_limits
   SET max_concurrent        = 80,
       hard_block_multiplier = 1.0,
       updated_at            = now()
 WHERE plan_id = 'starter';

UPDATE plan_limits
   SET max_concurrent        = 150,
       hard_block_multiplier = 1.0,
       updated_at            = now()
 WHERE plan_id = 'growth';

UPDATE plan_limits
   SET max_concurrent        = 350,
       hard_block_multiplier = 1.0,
       updated_at            = now()
 WHERE plan_id = 'pro';

-- business / enterprise intentionally untouched (NULL caps =
-- resolved per merchant via merchant_plan_limits; enforcement
-- fails closed without an override - merchant_limits.py:100-108).

COMMIT;

-- ROLLBACK (restores migration 049 seed values):
-- UPDATE plan_limits SET max_concurrent = 250,  hard_block_multiplier = 3.0 WHERE plan_id = 'starter';
-- UPDATE plan_limits SET max_concurrent = 600,  hard_block_multiplier = 3.0 WHERE plan_id = 'growth';
-- UPDATE plan_limits SET max_concurrent = 2000, hard_block_multiplier = 3.0 WHERE plan_id = 'pro';
