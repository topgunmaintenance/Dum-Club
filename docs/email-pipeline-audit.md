# Email pipeline audit — Resend / RESEND_API_KEY

A point-in-time audit of every email-sending path before active
merchant outreach. Use this to verify the email pipeline is wired
correctly on Railway and to test one reminder safely without spamming
real customers.

Source of truth: `backend/services/email.py` (sender) +
`backend/services/agents/{live,trial}_reminders.py` (callers) +
`backend/api/routes/checkout.py` (order lifecycle callers).

---

## TL;DR

| Question | Answer |
|---|---|
| Required env vars | `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_SITE_URL` (+ `OUTREACH_UNSUBSCRIBE_SECRET` for outreach, `FRONTEND_URL` for the unsubscribe link host) |
| Expected sender | `EMAIL_FROM` if set, else `DUM Club <orders@dum.club>` |
| Sending domain | `dum.club` — must be Resend-verified |
| Failure mode | Every send path catches all exceptions and logs; nothing in the order, signup, trial-reminder, live-reminder, or outreach flow breaks if Resend errors. |
| Disabled-config mode | If `RESEND_API_KEY` is empty, sends skip silently and log `[email] skipped (disabled: no RESEND_API_KEY)`. Crons still run their scan + claim loops. |

**Go decision:** safe to ship merchant outreach without RESEND_API_KEY
set in production — the platform will not crash, only emails won't go
out. Set the key whenever the team is ready to start sending; no code
deploy needed.

---

## Required Railway env vars

Set the same values on the API service **and** on every cron service
(trial_reminders, live_reminders). Schedule_rollforward does not send
email and only needs Supabase env.

| Var | Used by | Required? | Default |
|---|---|---|---|
| `RESEND_API_KEY` | every `_send()` call in `services/email.py` | **Yes for real sends.** When empty, the module logs `[email] startup: RESEND_API_KEY is not set — email delivery DISABLED until it is` and every send is a no-op. | none |
| `EMAIL_FROM` | the `from` field on every Resend send | No | `DUM Club <orders@dum.club>` |
| `NEXT_PUBLIC_SITE_URL` | builds CTA links in email bodies (`{SITE_URL}/dashboard`, `{SITE_URL}/orders`, `{SITE_URL}/project/{slug}`, `{SITE_URL}/hub`) | No (defaults), but always set in prod | `https://dum.club` |
| `FRONTEND_URL` | builds the unsubscribe link on outreach emails (kept separate so the unsub link routes through a known-good host even if `NEXT_PUBLIC_SITE_URL` is stale) | No (defaults), set in prod | `https://dum.club` |
| `OUTREACH_UNSUBSCRIBE_SECRET` | HMAC secret signing one-click unsub links | Yes for outreach. With the default value the module logs `[email] WARNING: OUTREACH_UNSUBSCRIBE_SECRET is not set — using default`. | a hardcoded placeholder |
| `STRIPE_PRICE_ID_STARTER` / `_GROWTH` / `_PRO` | trial-reminder cron maps price id → dollar amount in the email body | Yes for trial reminders | none |

### One-line readiness check

The `/api/health/email` endpoint (admin-gated) returns the canonical
status — use this in lieu of guessing whether env is wired:

```bash
curl https://<backend>/api/health/email \
  -H "Authorization: Bearer <admin_token>"
```

Healthy response:

```json
{
  "ok": true,
  "status": "healthy",
  "system": "email",
  "message": "Resend configured",
  "details": {
    "enabled": true,
    "provider": "resend",
    "key_set": true,
    "from_address": "DUM Club <orders@dum.club>",
    "mode": "enabled",
    "reason": ""
  }
}
```

Degraded:

```json
{
  "ok": false,
  "status": "degraded",
  "system": "email",
  "message": "RESEND_API_KEY is not set — email delivery disabled",
  "details": { "enabled": false, "key_set": false, ... }
}
```

---

## Expected sender address

The `from` field on every send is whatever `EMAIL_FROM` resolves to at
module-import time:

```python
_FROM_EMAIL = os.getenv("EMAIL_FROM", "DUM Club <orders@dum.club>")
```

Default: `DUM Club <orders@dum.club>`.

**The sending domain must be verified in the Resend dashboard.** If
`orders@dum.club` is not verified, Resend rejects every send with
`validation_error: domain is not verified` and the `_send()` catch
block logs:

```
[email] FAILED to=<addr> subject=<...> err=ApiError: validation_error: ...
```

To verify the domain:
1. Resend dashboard → Domains → Add `dum.club`
2. Add the DKIM + SPF + DMARC records to the DNS provider
3. Wait for the Resend dashboard to flip the domain to "Verified"
4. The next attempted send succeeds without code changes

---

## Email-sending call sites (the inventory)

Every place that calls into `services/email.py`:

| Caller | Function | Trigger | Fails gracefully? |
|---|---|---|---|
| `api/routes/checkout.py:459` | `send_buyer_payment_confirmed` | Stripe webhook on successful payment | Yes — wrapped in `try/except`; webhook returns 200 regardless |
| `api/routes/checkout.py:469` | `send_seller_new_order` | Stripe webhook on successful payment | Yes — same try/except |
| `api/routes/checkout.py:1516` | `send_buyer_fulfilled` | Seller marks order fulfilled | Yes — endpoint returns success regardless |
| `services/agents/trial_reminders.py:282-284` | `send_trial_t_minus_{14,7,1}` | Daily 09:00 ET cron | Yes — per-merchant errors logged, cron exits 0 |
| `services/agents/trial_reminders.py` (via webhook) | `send_trial_conversion_confirmed`, `send_payment_failed_notice` | Stripe `invoice.paid` / `invoice.payment_failed` webhook | Yes — webhook safe |
| `services/agents/live_reminders.py:157` | `send_live_reminder` | Every-5-min cron, fires for customers who tapped "Remind me when live" | Yes — claim-via-UPDATE happens BEFORE the send, so a Resend hiccup costs one customer one email but never breaks the cron |
| `api/routes/outreach.py:270,330` | `send_outreach_email` | Admin-triggered merchant outreach | Yes — returns `(False, error_message)` on failure, persisted on `outreach_messages.send_error` |

Every entry point has been verified to handle:
- `RESEND_API_KEY` missing (skip + log, no exception)
- Resend API raising (catch all exceptions, log, continue)
- Network timeout (caught by the same blanket `except Exception`)

So **no email path can break the surrounding flow**. This was the
explicit design intent in the `_send()` helper.

---

## Expected log shape

All log lines are grep-friendly and prefixed with `[email]` or the
agent name (`[live-reminders]`, `[trial-reminders]`).

### Startup (every container)

When the email module imports — once per container boot:

```
[email] startup: Resend enabled, from=DUM Club <orders@dum.club>
```

or, if not configured:

```
[email] startup: RESEND_API_KEY is not set — email delivery DISABLED until it is
```

### Per-send (success)

```
[email] sent to=customer@example.com subject='Topgun Maintenance LLC is going live now' id=re_abc123
```

The `id=` is Resend's message id, useful for digging into the Resend
dashboard if a recipient says they didn't get it.

### Per-send (skipped — no key)

```
[email] skipped (disabled: no RESEND_API_KEY) to=customer@example.com subject='...'
```

### Per-send (provider failure)

```
[email] FAILED to=customer@example.com subject='...' err=ApiError: <details from Resend>
```

Common `err=` values to expect:

| Error class | Meaning | Fix |
|---|---|---|
| `validation_error: domain is not verified` | Sending domain isn't verified in Resend | Verify `dum.club` in Resend dashboard |
| `validation_error: from must be a valid email address` | `EMAIL_FROM` is malformed | Fix `EMAIL_FROM` env (must be either `addr@host` or `Name <addr@host>`) |
| `rate_limit_exceeded` | Burst above Resend plan limit | Upstream throttle — retry later |
| `authentication_error: API key is invalid` | `RESEND_API_KEY` is wrong / rotated | Refresh the key in Railway |
| `timeout` | Network blip from Railway → Resend | Self-resolves on next send; no action |

### Outreach-specific

```
[email] outreach sent to=lead@example.com subject='We already built your store' id=re_abc
[email] outreach FAILED to=lead@example.com subject='...' err=...
```

The outreach paths additionally persist `send_ok` and `send_error` on
`outreach_messages` so you can audit failures in the database without
log spelunking.

---

## Failure-graceful proof points

Three real failure scenarios and what happens:

### 1. Resend is fully down

- `_send()` raises caught by the blanket `except Exception` → returns
  `True` (a send was attempted), logs `[email] FAILED to=...`.
- Caller (checkout webhook, cron, etc.) sees `True` but no actual
  email lands. The flow continues without raising.
- **No user-facing impact.** Customer sees the order completion screen
  / dashboard / live page; only the email is missing.

### 2. `RESEND_API_KEY` is empty in Railway

- Module-level startup print: `[email] startup: RESEND_API_KEY is not set — email delivery DISABLED until it is`.
- Every `_send()` short-circuits and prints `[email] skipped (disabled: no RESEND_API_KEY) to=... subject=...`.
- `EMAIL_ENABLED` flag is `False`; `/api/health/email` reports
  `enabled=false, status=degraded`.
- `live_reminders` cron still scans + claims rows (so when the key is
  set later, those already-claimed rows will NOT re-send — they're
  consumed). **This is a known trade-off.** See "Manual claim reset"
  below for how to un-claim rows if you flipped the key on after a
  rollout.

### 3. Resend returns 400 for one specific recipient (bad domain etc.)

- That one send logs `[email] FAILED to=baduser@nodomain.invalid ...`.
- Other recipients in the same cron pass succeed.
- The `live_reminders` row's `sent_at` stays stamped (at-most-once
  delivery); the row will not be retried.

---

## How to test ONE reminder safely

Two-step recipe that does NOT spam real customers.

### Option A: API-side seed + cron run (recommended)

1. Confirm `RESEND_API_KEY` is set in Railway env:

   ```bash
   curl https://<backend>/api/health/email -H "Authorization: Bearer <admin_token>"
   # expect: enabled=true, key_set=true
   ```

2. Seed a `live_reminders` row pointed at YOUR email and a real
   project (e.g. topgun-maintenance) with a `scheduled_for` ~2 min
   in the future. From the Supabase SQL editor:

   ```sql
   INSERT INTO live_reminders (project_id, customer_email, scheduled_for)
   SELECT id,
          'jmero1@gmail.com',
          now() + interval '2 minutes'
   FROM projects WHERE slug = 'topgun-maintenance' LIMIT 1
   RETURNING *;
   ```

3. Wait ~6 minutes (the next cron tick after `scheduled_for + WINDOW_AHEAD`).
   Check Railway logs for the `live_reminders` service:

   ```
   [live-reminders] window=[...,...) scanned=1 claimed=1 sent=1 errored=0
   [email] sent to=jmero1@gmail.com subject='Topgun Maintenance LLC is going live now' id=re_...
   ```

4. The email lands in your inbox within 30 seconds of the log line.
   Verify:
   - Subject reads "Topgun Maintenance LLC is going live now"
   - Sender is `DUM Club <orders@dum.club>` (or whatever `EMAIL_FROM`
     is set to)
   - The "Watch now →" button links to
     `{NEXT_PUBLIC_SITE_URL}/project/topgun-maintenance`
   - The `live_reminders` row now has a non-null `sent_at`:

     ```sql
     SELECT id, customer_email, scheduled_for, sent_at
     FROM live_reminders WHERE customer_email = 'jmero1@gmail.com'
     ORDER BY scheduled_for DESC LIMIT 1;
     ```

### Option B: direct module run from a one-off Railway shell

1. Open a one-off shell in the Railway dashboard against the API
   service container (same env as production).

2. Seed the row exactly as in Option A step 2.

3. Run the cron module directly:

   ```bash
   cd /app
   python -m services.agents.live_reminders
   ```

4. Verify the same log output and inbox arrival as Option A.

### Negative test — verify the duplicate-send protection

After Option A or B, run the cron module a second time:

```bash
python -m services.agents.live_reminders
```

Expected log line:

```
[live-reminders] window=[...,...) — 0 due
```

(zero because the partial index excludes the now-`sent_at`-stamped
row). You have proven duplicate protection works without spamming
yourself.

### Manual claim reset (only if you need to re-send)

If you accidentally rolled out a cron with a stale `RESEND_API_KEY`
and want to re-send already-claimed rows:

```sql
-- Reset every row claimed in the last hour so the next cron tick
-- re-sends them. Use with care — anyone whose email already landed
-- will get a duplicate.
UPDATE live_reminders
SET sent_at = NULL
WHERE sent_at > now() - interval '1 hour';
```

Better: only reset specific rows by `id`. This statement is destructive
to the idempotency invariant — only run it if you have an audit trail
proving the previous sends never landed.

---

## What is NOT in scope of this audit

- **SMS sends.** No SMS provider is wired today. Trial reminders and
  live reminders are email-only.
- **Push notifications.** Not implemented.
- **Email open / click tracking.** Resend's built-in tracking is on by
  default in the Resend dashboard; we do not surface it in DUM Club
  UI yet.
- **Email-template visual rendering.** Templates use inline HTML —
  test them in the Resend dashboard's "Send test" tool if you want
  a Litmus-style preview before a campaign.

---

## Go / no-go for outreach

| Gate | Status | What to do if not met |
|---|---|---|
| `RESEND_API_KEY` set on API service | **operator-config** | Set in Railway env → API service. Redeploy not strictly required (module re-reads on next container restart). |
| `RESEND_API_KEY` set on cron services | **operator-config** | Set on each of the three cron services (trial, live, schedule). |
| `dum.club` verified in Resend | **operator-config** | Verify domain + DNS records in Resend dashboard. |
| `OUTREACH_UNSUBSCRIBE_SECRET` set | **operator-config** | Set a random 32+ char string in Railway env. Once set, do NOT rotate without resetting all existing outreach unsubscribe tokens. |
| `NEXT_PUBLIC_SITE_URL` set to `https://www.dum.club` | **operator-config** | Already set in prod; verify it's not still pointing at a Vercel preview. |
| `/api/health/email` returns `ok=true` | **derived** | Falls out of the four config items above. |
| Test reminder lands in inbox (Option A above) | **operator-config** | Walk through the recipe above before pressing send on any merchant outreach. |

When all gates are green: the email pipeline is ready for active
merchant outreach.
