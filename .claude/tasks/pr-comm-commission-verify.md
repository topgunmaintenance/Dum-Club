TASK: pr-comm-commission-verify

Gate 1 — platform commission via Stripe application_fee_amount.

STATUS AT AUDIT (2026-06-13, prod snzodohibhxenqwdklxs): ALREADY
IMPLEMENTED AND APPLIED. This is NOT an unbuilt blocker. This task is
therefore a VERIFICATION + reconciliation pass, not an implementation.
Do not re-implement what exists; confirm it and close the two open
checks below.

What the audit found already in place:
- Migration 049 (plan_limits): APPLIED. Table exists, 5 tiers seeded,
  commission_rate = 0.0150 on every tier (starter/growth/pro/business/
  enterprise).
- Migration 050 (merchants.commission_rate_override): APPLIED. Column
  exists on merchants.
- Requirement (a) fail-closed NULL-vs-0.00: MET. services/commission.py
  resolve_commission_rate() reads the override with `if override is not
  None: return Decimal(str(override))` (commission.py ~86-91), so a
  stored 0.0000 comp is honored and never confused with NULL. NULL
  override + NULL plan rate raises CommissionRateUnset (fail closed).
- Stripe wiring: MET. checkout.py ~753-786 resolves the rate, computes
  application_fee_dec = seller_payout_cents * commission_rate, and sets
  payment_intent_data["application_fee_amount"] = application_fee_cents.
  CommissionRateUnset -> 4xx commission_rate_unset (no silent 0-fee
  sale). Order row persists resolved_commission_rate +
  application_fee_amount_cents (migration 052 columns).
- Requirement (b) no-double-bill: MET (calculator). overage_billing.py
  computes net_overage_cents = max(0, overage_owed_cents -
  sales_fee_earned_cents) — overage waived when the sales fee already
  covers video cost. NOTE: the BILLING RUN is still manual-only (admin
  endpoint), tracked separately in overage-auto-billing.md.
- PROVEN IN PROD: the 2026-06-02 paid order carried
  application_fee_amount_cents = 1 and resolved_commission_rate =
  0.0100. The wiring fired end-to-end against live Stripe.

OPEN CHECKS for the verification run (the only real work):
1. Rate progression: that proven order resolved at 0.0100 (1%) because
   it predated the 1.5% change. plan_limits now reads 0.0150. CONFIRM a
   fresh real paid order resolves resolved_commission_rate = 0.0150 and
   application_fee_amount_cents = round(payout * 0.015). (Migration 082
   set 0.0150; it is applied — plan_limits already shows it.) This is a
   one-order observation, not a code change.
2. No-double-bill is calculator-only until overage-auto-billing ships;
   confirm the netting formula against one real merchant-month once
   there is overage data. Cross-reference overage-auto-billing.md.

Dependencies (already satisfied — stated per the original gate): 049
and 050 both applied before PR-COMM is meaningful. Both are applied.

Human-review point: Julian confirms (from the Stripe dashboard) that a
real connected-account PaymentIntent shows application_fee_amount at
1.5% of the seller payout, and that the order row's
resolved_commission_rate = 0.0150. No code merge required unless the
verification surfaces a regression.

Do not run any migration. Do not change checkout.py / commission.py
unless the verification finds a defect; if it does, stop and report
before editing.
