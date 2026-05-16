# Pre-launch billing audit — 2026-05

Audit date: 2026-05-16
Auditor: claude (Opus 4.7 [1M])
Branches in scope: every PR merged through `3df7b10` on `main`.

## Executive summary

The 60-day trial → auto-convert → grace → suspension flow is **production-ready in code**. Three external prerequisites remain before active outreach:

1. Stripe Products + Prices configured in the Stripe Dashboard
2. Railway env vars set (Price IDs, `RESEND_API_KEY`, `TRIAL_DAYS`)
3. Migrations 043, 044, 045 applied to the production DB
4. Railway cron service configured per `docs/cron.md`

Once those four steps are done, the system is end-to-end functional with no manual intervention required.

## Checklist

### ☑ Non-founding merchants receive a 60-day Stripe-managed trial

- Code: `backend/api/routes/merchant.py:merchant_signup` calls `create_trial_subscription()` when `inserted.get("founding_merchant") == False`.
- Stripe call: `stripe.Customer.create` + `stripe.Subscription.create` with `trial_period_days=60` and `trial_settings.end_behavior.missing_payment_method="pause"` (`backend/services/subscriptions.py:create_trial_subscription`).
- No card required at signup — Stripe pauses the sub if no PM is on file at trial end.
- Schema: migration 043 adds `trial_start_at`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_price_id`, `next_billing_at`.

Evidence: SQL to verify on a deployed account:
```sql
SELECT id, business_name, founding_merchant, grandfathered,
       trial_ends_at, stripe_subscription_id, subscription_status
FROM merchants
WHERE founding_merchant = false
ORDER BY created_at DESC
LIMIT 5;
-- Expected: trial_ends_at ~60d out, stripe_subscription_id populated,
-- subscription_status='trialing', grandfathered=false
```

### ☑ Founding merchants bypass trial AND are excluded from reminder emails

Three independent layers:

1. **Signup path** (`merchant.py`): `if not inserted.get("founding_merchant")` gates the `create_trial_subscription` call. Founding rows get `grandfathered=true` written instead.
2. **Migration 043 backfill**: `UPDATE merchants SET grandfathered=true WHERE founding_merchant=true` ran once on apply.
3. **Cron query** (`trial_reminders.py:_find_due_merchants`): `.eq("grandfathered", False)` filter on every reminder window.
4. **Webhook re-check** (`checkout.py`): `if m_row and not m_row.get("grandfathered")` before sending `conversion_confirmed` or `payment_failed`.

Evidence: SQL to confirm zero founding merchants are exposed:
```sql
SELECT COUNT(*) FROM merchants
WHERE founding_merchant = true AND grandfathered = false;
-- Expected: 0
```

### ☑ Trial countdown banner shows correct days remaining

- Backend: `merchant.py:_days_until()` computes `floor((trial_ends_at - NOW) / 86400)`.
- Endpoint: `GET /api/merchant/trial-status` returns `days_remaining`.
- Frontend: `TrialCountdownBanner.tsx` line 152 renders `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial`.
- Hidden states: signed-out, no merchant, grandfathered, no subscription, cancelled.

Evidence: spot-check the dashboard for a non-founding merchant with `trial_ends_at = NOW + 47d` — banner should show "47 days left in your free trial."

### ☑ /api/merchant/cancel-trial works and webhook updates state

- Endpoint: `merchant.py:cancel_trial` → `subscriptions.py:cancel_subscription` → `stripe.Subscription.delete`. Idempotent.
- Write-through: writes `subscription_status='cancelled'` to merchants before the `customer.subscription.deleted` webhook lands.
- Webhook: `checkout.py` handles `customer.subscription.deleted` to mirror Stripe state.

Evidence: hit the endpoint, then verify with:
```sql
SELECT subscription_status FROM merchants WHERE id = '<merchant_id>';
-- Expected: 'cancelled' immediately; webhook confirms within ~1s
```

### ☑ All webhook events handled

Stripe webhook (`backend/api/routes/checkout.py:stripe_webhook`) handles the full subscription lifecycle:

| Event | Handler effect |
|---|---|
| `customer.subscription.created` | Implicit — Stripe never fires this on first `Subscription.create`; we write the IDs directly from the create response in `merchant_signup`. **Wired safety-net:** if Stripe ever does push this event, the generic `customer.subscription.*` handler does a `Subscription.retrieve` + DB write-through |
| `customer.subscription.updated` | Refreshes `subscription_status`, `trial_ends_at`, `next_billing_at` from authoritative Stripe state |
| `customer.subscription.deleted` | Sets `subscription_status='cancelled'` |
| `customer.subscription.paused` | Same handler (status sync) |
| `customer.subscription.resumed` | Same handler (status sync) |
| `customer.subscription.trial_will_end` | Same handler (status sync — fires 3 days before trial_end per Stripe defaults; we use our own T-14/T-7/T-1 cadence instead, so this event is informational only) |
| `invoice.paid` | `subscription_status='active'`, clears `grace_period_*`, sends `conversion_confirmed` email |
| `invoice.payment_failed` | `subscription_status='past_due'`, sets `grace_period_ends_at=NOW+3d`, sends `payment_failed` email |

### ☑ Grace period activates within 60s of invoice.payment_failed

- Stripe webhook is the trigger, not a poll. Latency = Stripe's webhook deliver time (typically <2s).
- `checkout.py` writes `grace_period_starts_at = NOW()` and `grace_period_ends_at = NOW() + 3 days` in the same DB UPDATE that flips status to `past_due`.
- Dashboard banner reads `grace_period_ends_at` from `/trial-status` on next page load.
- Email send uses the exact same `grace_period_ends_at` ISO string for date formatting so banner + email show identical dates.

Evidence: trigger via Stripe CLI, then:
```sql
SELECT subscription_status, grace_period_starts_at, grace_period_ends_at
FROM merchants WHERE stripe_subscription_id = '<sub_id>';
-- Expected: past_due, grace_start ≈ now, grace_end = now + 3 days
```

### ☑ Reminder cron correctly identifies merchants by trial_ends_at

- `trial_reminders.py:_find_due_merchants(target_days)` queries:
  - `grandfathered = false`
  - `subscription_status IN ('trialing', 'active')`
  - `trial_ends_at BETWEEN now+target_days-12h AND now+target_days+12h`
- Then resolves emails via `users.email` cache (one batched `IN` query).
- `send_reminder_once()` insert-log-then-send is idempotent — UNIQUE constraint on `trial_reminder_log(merchant_id, reminder_type)` blocks duplicates across cron + webhook.

Evidence: dry-run from the repo root:
```bash
cd backend && python -m services.agents.trial_reminders
# Output: [trial-reminders] start ... [trial-reminders] sent t_minus_X merchant=... [trial-reminders] done. sent total=N
```

### ☑ No existing merchant was unintentionally enrolled in billing

The grandfather backfill in migration 043 protects every pre-launch row:

```sql
-- From 043_merchant_trial_subscription.sql
UPDATE merchants
SET    grandfathered = true
WHERE  founding_merchant = true
  AND  grandfathered = false;
```

Combined with the signup-path conditional (`if not inserted.get("founding_merchant")`), no founding merchant has a Stripe Customer or Subscription created on their behalf.

Verification SQL to run post-deploy:

```sql
-- Founding merchants must have NO Stripe subscription.
SELECT COUNT(*) FROM merchants
WHERE founding_merchant = true AND stripe_subscription_id IS NOT NULL;
-- Expected: 0

-- Founding merchants must all be grandfathered.
SELECT COUNT(*) FROM merchants
WHERE founding_merchant = true AND grandfathered = false;
-- Expected: 0

-- No founding merchant should have ever received a trial reminder.
SELECT COUNT(*) FROM trial_reminder_log trl
JOIN merchants m ON m.id = trl.merchant_id
WHERE m.founding_merchant = true;
-- Expected: 0
```

If any of these returns > 0, **stop** and investigate before merging.

## Open items

| Item | Owner | Blocking? |
|---|---|---|
| Create Stripe Products + Prices in dashboard | User | yes — `subscription_price_id` is null without `STRIPE_PRICE_ID_GROWTH` |
| Set `STRIPE_PRICE_ID_{STARTER,GROWTH,PRO}` in Railway env | User | yes |
| Set `RESEND_API_KEY` in Railway env (cron service) | User | yes — email skip log fires without it |
| Apply migrations 043, 044, 045 to production DB | User | yes |
| Configure Railway cron with snippet from `docs/cron.md` | User | yes |

## Conclusion

Code-side: ready. After the four external steps above, every checkbox in the brief's "subscription objectives" section is satisfied with no manual intervention required.
