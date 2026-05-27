# LAUNCH.md — one-page operator launch checklist

**Time:** ~60 min hands-on + Resend DNS propagation wait.
**Goal:** Take production from "deployed code" to "ready for cold merchant outreach."

If anything fails, stop at that step and resolve. Don't proceed to the next.

This is the single canonical pre-outreach checklist. For deeper context per-step, see:
- `docs/hosting-stack.md` — services + env vars reference
- `docs/cron.md` — Railway cron service setup
- `docs/email-pipeline-audit.md` — RESEND_API_KEY + Resend domain
- `docs/operator-smoke-checklist.md` — 11-section browser smoke test

---

## Step 0 — Confirm `main` is deployed

In a terminal:

```bash
# Replace <backend> with your Railway backend URL (e.g. dum-club-api.up.railway.app)
curl -s https://<backend>/api/health | head -c 200
```

Expected: JSON containing `"ok": true` and a `commit` SHA. The SHA must match `git log -1 main --pretty=%H` from a fresh clone.

Vercel: dashboard → dum-club project → Deployments → latest production deploy points at the same SHA.

If either side lags: redeploy from the dashboard.

---

## Step 1 — Apply migration 067

Supabase dashboard → SQL Editor → New Query → paste:

```sql
CREATE TABLE IF NOT EXISTS merchant_recap_log (
  id            BIGSERIAL PRIMARY KEY,
  merchant_id   UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  recap_week    VARCHAR(8) NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lives_count       INTEGER,
  viewer_hours      NUMERIC(10,2),
  sales_count       INTEGER,
  gmv_usd           NUMERIC(10,2),
  top_offer_title   TEXT,
  next_live_at      TIMESTAMPTZ,
  CONSTRAINT uq_merchant_recap_week UNIQUE (merchant_id, recap_week)
);

CREATE INDEX IF NOT EXISTS idx_merchant_recap_log_merchant
  ON merchant_recap_log (merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_recap_log_sent_at
  ON merchant_recap_log (sent_at DESC);

ALTER TABLE merchant_recap_log ENABLE ROW LEVEL SECURITY;
```

Then verify:

```sql
SELECT to_regclass('public.merchant_recap_log') AS exists;
-- Expected: exists = "merchant_recap_log"
```

If the table didn't appear: STOP. Don't proceed.

---

## Step 2 — Verify Railway env vars (API service)

Railway dashboard → backend (API) service → Variables. Confirm:

| Var | Must be |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service-role JWT (starts `eyJ...`) |
| `RESEND_API_KEY` | `re_...` (from resend.com → API Keys) |
| `EMAIL_FROM` | `DUM Club <orders@dum.club>` |
| `NEXT_PUBLIC_SITE_URL` | `https://www.dum.club` |
| `FRONTEND_URL` | `https://www.dum.club` |
| `OUTREACH_UNSUBSCRIBE_SECRET` | random 32+ char string, NOT the placeholder default |
| `STRIPE_SECRET_KEY` | `sk_live_*` for production |
| `STRIPE_WEBHOOK_SECRET` | from Stripe dashboard webhook endpoint |
| `STRIPE_CONNECT_CLIENT_ID` | `ca_*` |
| `STRIPE_PRICE_ID_STARTER` | `price_*` ($39 tier) |
| `STRIPE_PRICE_ID_GROWTH` | `price_*` ($99 tier) |
| `STRIPE_PRICE_ID_PRO` | `price_*` ($299 tier) |
| `PRIVY_APP_ID` | same value as Vercel's `NEXT_PUBLIC_PRIVY_APP_ID` |
| `ENVIRONMENT` | `production` |

**Generate `OUTREACH_UNSUBSCRIBE_SECRET` if missing:**

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste the output. **Never rotate** this value after the first outreach email is sent.

**Verify config from CLI (admin token needed):**

```bash
curl -s https://<backend>/api/health/email -H "Authorization: Bearer <admin_jwt>" | head -c 300
```

Expected: `"enabled": true, "key_set": true, "from_address": "DUM Club <orders@dum.club>"`.

If `enabled: false`: stop. Fix env vars before continuing.

---

## Step 3 — Create the 3 new Railway cron services

`trial_reminders` already exists. Create three new cron services. For each:

Railway dashboard → **+ New** → **Empty Service** → Settings tab.

### 3a. `live_reminders`

| Setting | Value |
|---|---|
| Source | same repo + branch as backend (use `backend/` directory) |
| Deploy → Custom Start Command | `python -m services.agents.live_reminders` |
| Cron Schedule | `*/5 * * * *` |
| Timezone | UTC |
| Variables | "Reference variables from service" → API service → Copy all |
| Service name | `live_reminders` |

Click Deploy.

### 3b. `schedule_rollforward`

| Setting | Value |
|---|---|
| Source | same as 3a |
| Custom Start Command | `python -m services.agents.schedule_rollforward` |
| Cron Schedule | `0 * * * *` |
| Timezone | UTC |
| Variables | reference from API service |
| Service name | `schedule_rollforward` |

Click Deploy.

### 3c. `merchant_recap`

| Setting | Value |
|---|---|
| Source | same as 3a |
| Custom Start Command | `python -m services.agents.merchant_recap` |
| Cron Schedule | `0 9 * * 1` |
| Timezone | `America/New_York` (if Railway doesn't accept named TZ: use `0 13 * * 1` in UTC for EDT, or `0 14 * * 1` for EST) |
| Variables | reference from API service |
| Service name | `merchant_recap` |

Click Deploy.

### Verify

After 5 min, Railway → `live_reminders` → Logs should show:

```
[email] startup: Resend enabled, from=DUM Club <orders@dum.club>
[live-reminders] window=[...,...) — 0 due
```

After 1 hour, `schedule_rollforward` logs show:

```
[schedule-rollforward] now=... — 0 due
```

For `merchant_recap`, don't wait until Monday — click the service → "Trigger Cron Job" once. Logs should show:

```
[merchant-recap] start now=... window=[...] recap_week=YYYY-WNN
[merchant-recap] done scanned=... ...
```

If any service shows "Crashed" or "Restarting": stop. Open the logs.

---

## Step 4 — Verify Resend `dum.club` domain

[https://resend.com/domains](https://resend.com/domains)

1. If `dum.club` isn't there: click **Add Domain** → enter `dum.club` → Add.
2. Resend shows 5 DNS records (3× DKIM TXT, 1× SPF TXT, 1× DMARC TXT). Copy each.
3. In your DNS provider (Cloudflare / Namecheap / Route 53 / etc.) for `dum.club`:
   - Add 3 × `TXT` records: `resend._domainkey`, `resend2._domainkey`, `resend3._domainkey` with the values from Resend.
   - Add 1 × `TXT` at apex `@` for SPF (exact string from Resend).
   - Add 1 × `TXT` at `_dmarc` for DMARC (exact string from Resend).
4. Back in Resend dashboard → **Verify**. Wait 1-30 min for DNS propagation.
5. Status flips to **Verified** with a green dot.

**Verify from CLI:**

```bash
dig +short TXT resend._domainkey.dum.club
# Expected: non-empty value
```

If the status doesn't go green within 30 min, the DNS records aren't propagating — check the DNS provider.

---

## Step 5 — Grant admin to `jmero1@gmail.com`

Sign in to dum.club at least once with `jmero1@gmail.com` first (so the row exists in `users`).

Supabase SQL Editor:

```sql
UPDATE users SET is_admin = true WHERE email = 'jmero1@gmail.com';

-- Verify:
SELECT privy_id, email, is_admin FROM users WHERE is_admin = true;
```

Expected output: at least one row, with `email = 'jmero1@gmail.com'` and `is_admin = true`.

Then in the browser:
1. dum.club → Sign out (account menu)
2. Sign back in with the same email + OTP
3. Navigate to `https://www.dum.club/admin/operations` — should load.

If it redirects to `/`: clear Privy cookie, re-sign in.

---

## Step 6 — Walk the smoke checklist

Open `docs/operator-smoke-checklist.md`. Two browsers (signed-in operator + incognito buyer) + a real iPhone or Android phone (or DevTools mobile profile at 390 × 844).

Walk §1 through §11 in order. Don't skip steps.

**Critical pass-fail boxes** (any one of these failing = stop outreach):

- **§6** Live reminders cron actually sends an email + the log line shows `sent=1`
- **§7** `schedule_rollforward` advances `scheduled_live_at` by exactly +7 days
- **§8** Go-live → buyer page auto-flips within ~15s; end-live tears down on both sides
- **§10** Stripe $1 test charge → application fee is **exactly $0.01** (verify in Stripe dashboard → connected account → latest PaymentIntent → application_fee_amount = 1 cent)
- **§11** `/admin/operations` shows the Stripe fees 30d card with a number

**Test reminder cleanup** (after passing):

```sql
DELETE FROM live_reminders WHERE customer_email = 'jmero1+remindtest@gmail.com';
UPDATE projects SET recurring_weekly = false WHERE slug = 'topgun-maintenance';
-- Leave the $1 paid order — it counts as the Phase 0B unlock proof.
```

---

## Step 7 — Final go / no-go check

Run this single block on the production backend:

```bash
# Replace <backend> and <admin_jwt>
for endpoint in /api/health /api/health/email /api/health/checkout /api/health/dum; do
  echo "=== $endpoint ==="
  curl -s "https://<backend>$endpoint" -H "Authorization: Bearer <admin_jwt>" | head -c 200
  echo
done
```

All four must respond with `"ok": true` or `"status": "healthy"`.

Then in Supabase SQL Editor:

```sql
SELECT
  (to_regclass('public.merchant_recap_log') IS NOT NULL) AS recap_log_exists,
  (SELECT COUNT(*) FROM merchants
    WHERE founding_merchant = true AND grandfathered = false) = 0 AS founding_grandfather_intact,
  (SELECT COUNT(*) FROM merchants WHERE stripe_connect_status = 'connected') >= 1 AS at_least_one_connected,
  (SELECT COUNT(*) FROM users WHERE email = 'jmero1@gmail.com' AND is_admin = true) = 1 AS admin_operator_set;
```

All four columns must return `true`.

---

## ✅ GO criteria

Every box above checked.

You may begin active merchant outreach.

## 🛑 NO-GO

Any of the four critical smoke boxes failed (§6 / §7 / §8 / §10 / §11), or any of the four GO-check SQL columns returned `false`.

Stop. Fix. Re-run from that step.

---

## What this checklist intentionally skips

These are useful but not blocking:

- **Sentry frontend + backend** (`docs/OBSERVABILITY.md`) — visibility into errors, set up before scale not before launch
- **UptimeRobot on `/api/health`** — alert if backend goes down
- **AWS IVS Real-Time activation** (`docs/IVS_ACTIVATION.md`) — currently dormant; activate when you outgrow Mux

When you outgrow this checklist (~10+ merchants live), revisit those.
