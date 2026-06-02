# Stripe + Railway pre-launch setup

This is the single source of truth for the external setup steps the
60-day trial → auto-convert system needs before active outreach.
Code is already deployed; the only work left is dashboard + env config.

Estimated time: 20 minutes.

## 1. Create Stripe Products + Prices

In the Stripe Dashboard ([dashboard.stripe.com](https://dashboard.stripe.com/products)), create the three self-serve recurring Products. For each Product create one Price (monthly recurring USD).

| Product name | Price | Billing | Stripe Price id → record into | Required? |
|---|---|---|---|---|
| **DUM Club Starter** | $29.00 | Recurring · monthly | `STRIPE_PRICE_ID_STARTER` | yes |
| **DUM Club Growth** | $49.00 | Recurring · monthly | `STRIPE_PRICE_ID_GROWTH` | **yes — default tier on signup** |
| **DUM Club Pro** | $99.00 | Recurring · monthly | `STRIPE_PRICE_ID_PRO` | yes |
| **DUM Club Business** | $499.00 | Recurring · monthly | `STRIPE_PRICE_ID_BUSINESS` | **no — optional / defer** |

### About the Business tier

The Business plan is **internal / custom-quote**. It is intentionally NOT
wired into the auto-trial signup flow:

- `backend/services/subscriptions.py:_resolve_price_id` only knows
  `starter`, `growth`, and `pro`. Business is never auto-provisioned.
- The Stripe Subscription created on signup always uses `STRIPE_PRICE_ID_GROWTH`
  (the default tier).
- Both `/pricing` and `/business` hide Business + Enterprise behind a
  "Need a bigger plan? →" disclosure. The CTA is a `mailto:` link to
  Julian, not a self-serve checkout.
- Public marketing copy (homepage, /business, /pricing summary,
  investors page, layout `<meta>`) all use "$29 to $99/month" — the
  range that excludes Business.

**Recommendation:** skip creating the Business Product + Price now.
Create it only when a real merchant emails about white-label loyalty
and you negotiate the actual contract terms (the $499 figure may
shift up or down per deal). Setting `STRIPE_PRICE_ID_BUSINESS` in
Railway env is a no-op until that day.

### Notes
- All prices in USD.
- Tax behavior: leave default ("Exclusive") unless you're already collecting tax.
- Lookup keys are optional; the env vars below carry the canonical reference.

After creating the three required Products, copy each Price id (format `price_1ABC...`) and keep them ready for step 3.

## 2. Configure the Stripe webhook endpoint

Stripe → Developers → Webhooks → **Add endpoint**.

| Field | Value |
|---|---|
| Endpoint URL | `https://api.dum.club/api/checkout/webhook` (or the production backend URL serving FastAPI) |
| API version | latest |
| Events to send | see list below |

**Events to subscribe to** (nine total — six subscription events plus three marketplace-order refund/dispute events):

Subscription / billing:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.payment_succeeded` *(alias for the `invoice.paid` handler in code)*
- `invoice.payment_failed`

Marketplace-order refund / dispute (added in PR B):
- `charge.refunded` — buyer refund (full or partial). Mirrors order status to `refunded` / `partially_refunded`.
- `charge.dispute.created` — buyer files a chargeback. Mirrors order status to `disputed`.
- `charge.dispute.closed` — chargeback resolved. Sets status to `paid` (won / warning_closed), `chargeback` (lost), or leaves it as `disputed` for any other outcome.

After creating the endpoint, click **Reveal signing secret** and copy `whsec_…`. This goes into `STRIPE_WEBHOOK_SECRET` in step 3.

Note: the same webhook endpoint already handles Connect events (`checkout.session.completed`, `payment_intent.succeeded`, `account.updated`) for merchant payouts. Add the nine events to the existing endpoint — do not create a second one.

## 3. Set Railway env vars

Railway → DUM Club backend service → **Variables**. Add or update:

| Variable | Value | Where it's read |
|---|---|---|
| `STRIPE_PRICE_ID_STARTER` | `price_…` from step 1 | `backend/services/subscriptions.py`, `backend/api/routes/merchant.py` |
| `STRIPE_PRICE_ID_GROWTH` | `price_…` from step 1 | same — default tier; required |
| `STRIPE_PRICE_ID_PRO` | `price_…` from step 1 | same |
| `STRIPE_PRICE_ID_BUSINESS` | leave unset for launch | reserved; not read by code today. Set only when you've created the Business Product per step 1's optional path |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` from step 2 | `backend/api/routes/checkout.py:stripe_webhook` |
| `STRIPE_SECRET_KEY` | `sk_live_…` (already set) | confirm still present |
| `TRIAL_DAYS` | `60` *(optional override; default 60)* | `backend/services/subscriptions.py` |
| `GRANDFATHER_CUTOFF_AT` | *(reserved for future use; not currently read by code — grandfathering is keyed off `founding_merchant` flag, not date)* | n/a |
| `RESEND_API_KEY` | confirm already set | `backend/services/email.py` |

After updating, **redeploy** the backend service so the new env values are loaded.

## 4. Apply migrations 043, 044, 045

In order:

```bash
# Connect to the production Supabase Postgres
psql $SUPABASE_DB_URL

# Apply each in sequence
\i backend/db/migrations/043_merchant_trial_subscription.sql
\i backend/db/migrations/044_trial_reminder_log.sql
\i backend/db/migrations/045_merchant_grace_period.sql
```

Or via Supabase Studio SQL editor: paste each file's contents into a new query and run.

After applying, confirm the grandfather backfill landed:

```sql
SELECT COUNT(*) FROM merchants WHERE founding_merchant = true AND grandfathered = false;
-- Expected: 0
```

## 5. Configure the daily reminder cron

Per `docs/cron.md`:

- Railway → New Service → Cron Job (reuse the same Dockerfile / repo as the backend API service)
- Schedule (5-field with TZ): `0 9 * * *`
- Timezone: `America/New_York`
- Start command: `python -m services.agents.trial_reminders`
- Inherit all env vars from the API service (or copy `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SITE_URL`, `STRIPE_PRICE_ID_*` explicitly).

Verify with a manual run from the cron service's shell:

```bash
python -m services.agents.trial_reminders
# Expected output:
# [trial-reminders] start at 2026-05-16T...
# [trial-reminders] done. sent total=0 (t-14=0, t-7=0, t-1=0) suspended=0
# (Counts are 0 on first run because no trial windows have elapsed yet.)
```

## 6. Smoke test in production

Once 1-5 are complete, run these in order on a throwaway test merchant:

1. **Trial creation.** Sign up as a non-founding merchant. In Stripe Dashboard, confirm a Customer + Subscription appear, `subscription_status='trialing'`, `trial_end` = signup + 60 days.
2. **Dashboard banner.** Load `/dashboard` for the test merchant. The TrialCountdownBanner should show "60 days left in your free trial" and the correct billing-start date.
3. **Webhook → DB sync.** In Stripe Dashboard, edit the test Subscription → Pause. In Supabase, confirm `merchants.subscription_status` flips to `paused`.
4. **Payment-failed path.** Stripe CLI: `stripe trigger invoice.payment_failed --override invoice:subscription=<sub_id>`. Confirm:
   - `subscription_status = 'past_due'`
   - `grace_period_ends_at` ≈ NOW + 3 days
   - Email arrives at the test address
   - Dashboard banner shows "Your payment didn't go through" + the grace-end date
5. **Suspension sweep.** In Supabase, manually `UPDATE merchants SET grace_period_ends_at = NOW() - INTERVAL '1 hour' WHERE id = '<test_id>';` Run the cron. Confirm `subscription_status = 'suspended'`.
6. **Suspension gate.** As the suspended merchant, try Go Live and try to create a checkout. Both should return 402 with plain-English messages.
7. **Founding safety.** Pick one existing founding merchant. Confirm `grandfathered=true`, no `stripe_subscription_id`, no rows in `trial_reminder_log` for them.

## Done?

If all seven smoke tests pass, the platform is ready for outreach.
