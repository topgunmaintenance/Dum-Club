# Fee language — "Marketplace Fee"

## Decision

The 1% deduction DUM Club takes from every marketplace sale is called
**"Marketplace Fee"** in all merchant-facing, admin-facing, and Stripe-
metadata surfaces. The CLAUDE.md doctrine value is unchanged at 1%.

This is purely a wording / labeling decision. The math, routing, and
Stripe Connect mechanics are not affected.

## Rule of thumb per surface

| Surface | Term | Notes |
|---|---|---|
| Merchant dashboard order list | **Marketplace Fee** | `frontend/app/project/[id]/page.tsx` order summary. Shows "Gross Sale / Marketplace Fee / Net Received". |
| Admin operations dashboard | **Marketplace Fees** (plural) | `frontend/app/admin/operations/page.tsx` 30-day aggregate card. |
| Stripe Checkout Session metadata | `marketplace_fee_cents`, `marketplace_fee_percent`, `seller_receives_cents`, `gross_sale_cents`, `fee_label="DUM Club Marketplace Fee"` | Operator can read these in the Stripe Dashboard payment detail panel. |
| Stripe `application_fee_amount` API field | **unchanged** | Stripe's required term. Do not rename. |
| Stripe Dashboard "Application Fee" line item | **unchanged — not configurable** | Stripe hard-codes this label in its dashboard UI. Operators learn from the `fee_label` metadata key alongside it. |
| Database column `application_fee_amount_cents` | **unchanged** | Schema column name; renaming requires a migration with no business value. |
| Database column `platform_fee_usd` | **unchanged** | Schema column name. The 30-day aggregate sum from this column is what the admin card now labels "Marketplace Fees". |
| Customer (buyer) receipts | **gross only** | Stripe sends the buyer's receipt with the line-item price. We do not surface the Marketplace Fee to the customer; it's deducted from the merchant payout, not added on top of the customer total. |
| Marketing copy ("Whatnot takes 8% commission") | **unchanged** | Competitor-fee references stay as "commission" — that's the competitor's term, not ours. |
| Backend internal log lines | **unchanged for now** | `[checkout] application_fee_cents=N` stays in Railway logs — operator-only, not user-visible. Can be refreshed in a follow-up. |

## Why "Application Fee" persists in some places

Stripe's API contract names the field `application_fee_amount` and the
Stripe Dashboard displays this line as "Application Fee" with no override.
We can not rename Stripe's UI label from the API. We can — and do — carry
the product-side name "DUM Club Marketplace Fee" in metadata so anyone
reading the Stripe payment detail panel sees both labels side by side.

DB column names stay because renaming them is a migration with no user-
visible value and a real risk of breaking dependent reports.

## What this rule does NOT cover

- The math: the rate is 1.00% per CLAUDE.md §3 and `plan_limits.commission_rate`.
  This document does not change that.
- The Stripe Connect routing: direct charges with `application_fee_amount`
  remain the model per `backend/api/routes/checkout.py:781-784`.
- Customer-facing buyer receipts: no change. The Marketplace Fee is
  invisible to the buyer because it is merchant-paid, not customer-paid.

## Related files

- `frontend/app/project/[id]/page.tsx` — merchant order summary
- `frontend/app/admin/operations/page.tsx` — admin operations dashboard
- `backend/api/routes/checkout.py` — Stripe Session metadata
- `backend/services/commission.py` — rate resolution (math, not labels)
- `backend/api/routes/admin.py` — operations API response shape (key names
  unchanged for backward compatibility; the label change is frontend-only)
