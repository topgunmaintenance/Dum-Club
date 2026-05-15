# Cron jobs

DUM Club's background jobs run on Railway's cron scheduler. One job today:
the daily trial-reminder sweep.

## Trial reminder cron (daily 09:00 America/New_York)

Sends the T-14, T-7, and T-1 trial countdown emails to non-grandfathered
merchants whose Stripe subscription is `trialing` or `active` and whose
`trial_ends_at` falls in the relevant window.

Conversion-confirmed and payment-failed emails are not sent by this cron —
they fire from the Stripe webhook handler in `backend/api/routes/checkout.py`
because they're event-driven, not time-driven.

### Railway configuration

Add a new cron service on the same Railway project, pointing at the backend
service's Dockerfile / runtime. In the Railway dashboard:

1. New service → "Cron Job"
2. Source: same repo, `backend/` root
3. Build / start command: same as the API service (so `from db.supabase`
   and `from services.email` resolve identically)
4. Cron schedule (5-field with TZ): `0 9 * * *`
5. Timezone: `America/New_York`
6. Run command:

   ```
   python -m services.agents.trial_reminders
   ```

   (If invoking from the repo root rather than `backend/`, prefix with
   `backend.`: `python -m backend.services.agents.trial_reminders`.)

### Env vars the cron needs

The cron service must inherit the same env as the API service. Critical:

| Var | Why |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | DB read/write |
| `RESEND_API_KEY` | email send |
| `EMAIL_FROM` | sender address |
| `NEXT_PUBLIC_SITE_URL` | CTA links in email bodies |
| `STRIPE_PRICE_ID_STARTER` / `_GROWTH` / `_PRO` | maps price id → dollar amount |

### Idempotency

Every email send writes one row to `trial_reminder_log` with a UNIQUE
constraint on `(merchant_id, reminder_type)`. The cron tries to INSERT
the log row first; if Postgres returns a unique violation, the reminder
was already sent by an earlier run (or the webhook) and the cron skips
silently. Safe to re-run any time.

### Manual run for testing

```
cd backend
python -m services.agents.trial_reminders
```

Output goes to stdout:

```
[trial-reminders] start at 2026-05-15T14:00:00+00:00
[trial-reminders] sent t_minus_7 merchant=abc-123 plan=$49/mo end=May 22, 2026
[trial-reminders] done. sent total=1 (t-14=0, t-7=1, t-1=0)
```

### Founding-merchant safety

The query that drives the cron filters `grandfathered = false`. Migration
043 backfilled `grandfathered = true` for every existing
`founding_merchant = true` row, and `merchant.py:signup` sets the flag
for every new founding signup. So no founding shop is ever picked up by
this cron. If you ever need to verify in production:

```sql
SELECT COUNT(*) FROM merchants
WHERE founding_merchant = true AND grandfathered = false;
-- Expected: 0
```

If that returns > 0, do **not** ship reminders before re-running the
backfill from 043.
