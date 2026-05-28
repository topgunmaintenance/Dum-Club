# Cron jobs

DUM Club's background jobs run on Railway's cron scheduler. Four jobs
today; each one runs as its own Railway cron service that shares env
with the API service so `from db.supabase` and `from services.email`
resolve identically.

| Job | Cadence | Module | Purpose |
|---|---|---|---|
| Trial reminders + suspension sweep | daily 09:00 ET | `services.agents.trial_reminders` | T-14 / T-7 / T-1 trial emails, past_due → suspended sweep |
| Live reminders | every 5 minutes | `services.agents.live_reminders` | Send "they're going live now" emails to customers who tapped Remind me |
| Schedule rollforward | hourly | `services.agents.schedule_rollforward` | Advance `projects.scheduled_live_at` by +7 days for merchants with `recurring_weekly=true` |
| Weekly merchant recap | weekly Mon 09:00 ET | `services.agents.merchant_recap` | Send each active merchant a one-paragraph recap of last week's lives / viewer-hours / sales / next live |

All three live in `backend/services/agents/`. Each module is safe to
run repeatedly: each one uses an atomic claim (live_reminders) or a
self-deduplicating WHERE clause (schedule_rollforward, trial_reminders)
to make double-runs harmless.

---

## Trial reminder cron (daily 09:00 America/New_York)

Two responsibilities, run in sequence by the same entrypoint:

1. **Trial reminder emails.** Sends T-14 / T-7 / T-1 countdown emails to
   non-grandfathered merchants whose Stripe subscription is `trialing` or
   `active` and whose `trial_ends_at` falls in the relevant window.
2. **Suspension sweep.** Moves merchants from `subscription_status='past_due'`
   to `'suspended'` once their 3-day payment-failure grace period has
   elapsed without an `invoice.paid` recovery. Suspended merchants keep
   dashboard access but cannot Go Live or take new orders.

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
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | DB read/write |
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

---

## Live reminders cron (every 5 minutes)

Sends a "they're going live now" email to every customer who tapped the
"Remind me when live" button on a storefront whose merchant scheduled
the next live slot. Drives the customer retention loop introduced in
PR #288 (`live_reminders` table) + PR #287 (`projects.scheduled_live_at`).

The worker scans a small partial index (`live_reminders` rows with
`sent_at IS NULL`) so the 5-minute cadence is cheap. Each row is claimed
atomically via `UPDATE ... WHERE sent_at IS NULL` so two concurrent runs
never produce a duplicate send: the second worker sees 0 rows affected
and skips.

### Railway configuration

1. New service → "Cron Job"
2. Source: same repo, `backend/` build context
3. Build / start command: same as the API service
4. Cron schedule (5-field): `*/5 * * * *`
5. Timezone: UTC (the worker reasons in UTC; cadence does not need a TZ)
6. Run command:

   ```
   python -m services.agents.live_reminders
   ```

   (Alternative for repo-root execution:
   `python -m backend.services.agents.live_reminders`.)

### Env vars

Same as the API service. The bare minimum:

| Var | Why |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | scan `live_reminders` + read `projects` + atomic claim |
| `RESEND_API_KEY` | email send via Resend |
| `EMAIL_FROM` | sender address shown to customer |
| `NEXT_PUBLIC_SITE_URL` | builds the "Watch now" link in the email body (`{SITE_URL}/project/{slug}`) |

Without `RESEND_API_KEY` the worker logs

```
[live-reminders] EMAIL disabled (no RESEND_API_KEY). Worker will scan and claim but won't actually send. Set RESEND_API_KEY in Railway env to enable.
```

at startup, then runs the scan + claim loop with no real send (rows
still get their `sent_at` stamped because the claim is the gate, not
the send result — see "Failure behavior" below).

### Window math

- `WINDOW_AHEAD = 6 min` — the next-tick safety buffer. With a 5-min
  cadence every signup enters the send window within one tick of its
  `scheduled_for`.
- `GRACE_BEHIND = 15 min` — rows that missed their tick are still
  picked up for up to 15 minutes after `scheduled_for`. Anything older
  than that is dropped silently (a "they went live 30 min ago" email
  is worse than no email).

### Duplicate-send protection

Three layers:

1. Partial index `live_reminders_pending_idx` on `(scheduled_for) WHERE
   sent_at IS NULL` — the scan only sees un-sent rows.
2. Atomic claim:

   ```sql
   UPDATE live_reminders SET sent_at = now()
   WHERE id = $1 AND sent_at IS NULL
   RETURNING *;
   ```

   Whoever wins the `RETURNING` owns the send. The loser sees 0 rows
   and skips silently.
3. The claim happens **before** the email send call. If Resend errors
   we deliberately do NOT clear `sent_at` — see "Failure behavior".

So even if you accidentally provision two `live_reminders` cron
services pointing at the same database, each customer gets exactly
one email.

### Failure behavior

The worker exits 0 on every run (per-row errors are logged, not
re-raised) so the cron does not retry the whole batch. Three failure
modes worth knowing:

| Failure | What happens | Recovery |
|---|---|---|
| Supabase scan fails | Prints `[live-reminders] scan failed: <repr>`, returns empty counts | Next tick retries — the scan is read-only |
| Atomic claim fails (race) | Loser sees 0 rows affected, skips silently | Winner has already sent — correct |
| Resend send raises | Row stays stamped with `sent_at`. We **do not** clear it. | Customer misses this reminder. At-most-once delivery — the alternative (rollback `sent_at` on failure) would risk duplicate sends if a later run partially succeeds for the same row. Reminder is one-shot; we err on the side of "miss one" rather than "send twice". |

The cron never runs SQL that could damage another subsystem. It does
not touch `projects`, `orders`, `merchants`, or any auth/billing table
beyond reading `projects.{id,slug,name,title}` to render the email
body.

### Logs to expect

Healthy run with nothing due:

```
[email] startup: Resend enabled, from=DUM Club <orders@dum.club>
[live-reminders] window=[2026-05-27T18:05:00+00:00,2026-05-27T18:11:00+00:00) — 0 due
```

Healthy run with sends:

```
[email] startup: Resend enabled, from=DUM Club <orders@dum.club>
[email] sent to=customer@example.com subject='Topgun Maintenance LLC is going live now' id=re_xyz
[live-reminders] window=[...,...) scanned=1 claimed=1 sent=1 errored=0
```

Email disabled (RESEND_API_KEY missing):

```
[email] startup: RESEND_API_KEY is not set — email delivery DISABLED until it is
[live-reminders] EMAIL disabled (no RESEND_API_KEY). Worker will scan and claim but won't actually send. Set RESEND_API_KEY in Railway env to enable.
[email] skipped (disabled: no RESEND_API_KEY) to=customer@example.com subject='...'
[live-reminders] window=[...,...) scanned=1 claimed=1 sent=0 errored=0
```

### Manual run for testing

```
cd backend
python -m services.agents.live_reminders
```

Seed a test row first (replace project_id with a real one):

```sql
INSERT INTO live_reminders (project_id, customer_email, scheduled_for)
VALUES (
  '<your-project-uuid>',
  'you@example.com',
  now() + interval '2 minutes'
);
```

Then run the cron module twice with a 3-minute gap. First run: row not
yet in window, `scanned=0`. Second run: row in window, `sent=1`. Third
run (any time later): the partial index excludes the now-stamped row,
`scanned=0` — proves duplicate protection.

---

## Schedule rollforward cron (hourly)

For merchants who opted into weekly recurring lives via
`projects.recurring_weekly = true`, this worker advances
`scheduled_live_at` by +7 days after each scheduled slot passes so the
storefront's "Going live..." banner keeps surfacing the next upcoming
slot without merchant intervention.

The worker handles paused-cron recovery: if it hasn't run in 3 weeks,
the first run jumps the schedule the smallest N weeks that lands
strictly in the future (no tight +7 loop).

### Railway configuration

1. New service → "Cron Job"
2. Source: same repo, `backend/` build context
3. Build / start command: same as the API service
4. Cron schedule (5-field): `0 * * * *`
5. Timezone: UTC
6. Run command:

   ```
   python -m services.agents.schedule_rollforward
   ```

   (Alternative for repo-root execution:
   `python -m backend.services.agents.schedule_rollforward`.)

### Env vars

| Var | Why |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | scan `projects` + update `scheduled_live_at` |

**No** `RESEND_API_KEY` needed — this cron does not send email.

### Safety properties

- One `UPDATE` per row, touching only `scheduled_live_at`. No DELETE,
  no DROP, no other column writes.
- `recurring_weekly` stays `true`. The merchant explicitly opted in;
  the worker never unsets the flag.
- Concurrent workers are safe: the WHERE clause filters
  `scheduled_live_at < now()`, so once one worker rolls a row forward
  the row no longer matches the query for the second worker.
- Exits 0 always. Per-row errors are logged and the batch continues.

### Logs to expect

Healthy run with nothing due:

```
[schedule-rollforward] now=2026-05-27T18:00:00+00:00 — 0 due
```

Healthy run with rollforwards:

```
[schedule-rollforward] now=2026-05-27T18:00:00+00:00 scanned=3 rolled=3 errored=0
```

Scan failure (rare; next tick retries):

```
[schedule-rollforward] scan failed: PostgrestAPIError(...)
```

### Manual run for testing

```
cd backend
python -m services.agents.schedule_rollforward
```

Seed a row that should roll forward:

```sql
UPDATE projects
SET scheduled_live_at = now() - interval '8 days',
    recurring_weekly = true
WHERE slug = 'topgun-maintenance';
```

Then run the module. Expected: `scanned=1 rolled=1`, and a follow-up
`SELECT scheduled_live_at FROM projects WHERE slug='topgun-maintenance'`
shows a value strictly in the future (~6 days out).

---

## Weekly merchant recap cron (Monday 09:00 ET)

Sends each active merchant a friendly one-paragraph recap of last
week's activity: number of lives, viewer-hours, sales count + GMV,
top offer, next scheduled live. Skips merchants who had zero
activity AND nothing scheduled (the email never reads "you did
nothing"). Idempotent via `merchant_recap_log` with a UNIQUE
constraint on `(merchant_id, recap_week)`.

### Railway configuration

1. New service → "Cron Job"
2. Source: same repo, `backend/` build context
3. Build / start command: same as the API service
4. Cron schedule (5-field with TZ): `0 9 * * 1`
5. Timezone: `America/New_York`
6. Run command:

   ```
   python -m services.agents.merchant_recap
   ```

   (Alternative for repo-root execution:
   `python -m backend.services.agents.merchant_recap`.)

### Env vars

Same as the API service. The bare minimum:

| Var | Why |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | scan `merchants` + `users` + `projects` + `stream_sessions` + `orders` + write `merchant_recap_log` |
| `RESEND_API_KEY` | email send via Resend |
| `EMAIL_FROM` | sender address shown to merchant |
| `NEXT_PUBLIC_SITE_URL` | builds the "Open your dashboard" link |

Without `RESEND_API_KEY` the worker scans + claims rows in
`merchant_recap_log` but skips the actual send and logs
`[email] skipped (disabled: no RESEND_API_KEY)`.

### Week math

- `window_start` = previous Monday 00:00 UTC
- `window_end`   = this Monday 00:00 UTC (exclusive)
- `recap_week`   = ISO 8601 week label of last week (e.g. `2026-W21`)

The cron is intentionally scheduled at 09:00 ET on Monday so the
email lands first thing in the merchant's inbox after the weekend.
"Last week" is treated as Mon-Sun UTC; this approximates each
merchant's local week well enough for a recap (precision per
timezone isn't worth the complexity).

### Idempotency

Pre-send: every send INSERTs one row into `merchant_recap_log` with
UNIQUE `(merchant_id, recap_week)`. The cron's insert-then-send
pattern means a duplicate run for the same week skips silently:
the unique violation IS the dedup signal.

### Failure behavior

| Failure | What happens | Recovery |
|---|---|---|
| Supabase scan fails | Logs `[merchant-recap] merchant scan failed: <repr>` and returns empty counts | Next week's tick retries; one missed week is recoverable by manually re-running the module after fixing the cause |
| Per-merchant aggregation fails | Logs `[merchant-recap] merchant <id> failed: <repr>` and continues to the next merchant | Batch is not retried — the merchant misses one recap |
| Email send fails | Log row was already written before the send; row stays as the dedup record | Same week, same merchant: no retry. At-most-once delivery. |

The cron never deletes data, never updates merchant rows, and
never changes order/payment state. It is strictly a read-aggregate-
write-log-send loop.

### Skip rules

A merchant is skipped (and gets NO email) when:

- `users.email` is empty for the merchant's `owner_privy_id` — we
  have nowhere to send. (`skipped_no_email` counter.)
- The merchant had 0 streams, 0 paid orders, AND no upcoming
  `scheduled_live_at`. (`skipped_no_activity` counter.)
- The same `(merchant_id, recap_week)` row already exists in
  `merchant_recap_log` — handled by the unique violation.

### Logs to expect

Healthy run with sends:

```
[merchant-recap] start now=2026-06-01T13:00:00+00:00 window=[2026-05-25T00:00:00+00:00,2026-06-01T00:00:00+00:00) recap_week=2026-W22
[merchant-recap] sent merchant=<uuid> lives=3 sales=12 gmv=$240.00 week=2026-W22
[email] sent to=julian@topgunmaintenance.com subject='Your week on DUM Club (May 25-31)' id=re_...
[merchant-recap] done scanned=27 skipped_no_email=2 skipped_no_activity=14 claimed=11 sent=11 errored=0
```

### Manual run for testing

```
cd backend
python -m services.agents.merchant_recap
```

To replay one specific merchant for last week (useful for testing
copy without spamming everyone), insert a one-row log to claim the
slot for every OTHER merchant then run the cron:

```sql
-- Pre-claim everyone except your target so the cron only emails
-- the target merchant.
INSERT INTO merchant_recap_log (merchant_id, recap_week)
SELECT id, '2026-W22' FROM merchants
WHERE id <> '<your-target-merchant-uuid>'
  AND stripe_connect_status = 'connected'
ON CONFLICT DO NOTHING;
```

Then run the cron module — only your target merchant has an open
slot, so they're the only send.

To completely reset a week so the next run re-sends to everyone:

```sql
DELETE FROM merchant_recap_log WHERE recap_week = '2026-W22';
```

(Destructive — only use in test / staging or in a recovery where
you have proof the prior sends never landed.)

---

## Why four separate cron services?

Each Railway cron service is a single one-shot execution at a single
cadence. The platform doesn't have a "run multiple jobs at different
cadences from one service" mode. Splitting the three jobs gives:

- Independent failure surfaces — `live_reminders` crashing does not
  delay `schedule_rollforward`.
- Independent logs — easier to grep "[live-reminders]" without sifting
  through trial-reminder noise.
- Independent restart cadence — Railway treats the API service and
  each cron service as its own deploy.

The web service is not affected by any cron. Each cron service runs
as a separate container process. The cron container exits 0 after a
single pass and Railway tears it down; the API service container is
long-running and untouched.

### Sanity check before relying on the crons

After deploying all three cron services, verify each one ran at least
once by tailing logs in the Railway dashboard:

```
Service: trial_reminders      → expect a 09:00 ET line within 24h
Service: live_reminders       → expect a window line within 5 min
Service: schedule_rollforward → expect a "now=..." line within 1 hour
Service: merchant_recap       → expect a "start now=..." line within 7 days
```

If a service shows no log lines after its first scheduled tick:
1. Check the service's "Crashed" / "Restarting" status in the dashboard
2. Confirm env vars match the API service (same `SUPABASE_URL` and
   `SUPABASE_SERVICE_KEY`, in particular)
3. Confirm the run command is exactly the string above — typos in the
   module path produce a `ModuleNotFoundError` at startup
