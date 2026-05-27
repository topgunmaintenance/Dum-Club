# Hosting stack — Vercel / Railway / Supabase

Single source of truth for how production is wired. Every other doc
in this folder assumes this layout. If a future change splits, moves,
or replaces one of these three services, update this file FIRST so
the assumption drift is caught early.

---

## High-level

```
                       ┌─────────────────────────────┐
                       │   Vercel (iad1, Washington) │
                       │   Next.js 14 — frontend     │
                       │   www.dum.club              │
                       └────────────┬────────────────┘
                                    │ HTTPS (NEXT_PUBLIC_API_URL)
                                    ▼
                       ┌─────────────────────────────┐
                       │   Railway — backend         │
                       │   FastAPI (api service)     │
                       │   + 4 cron services         │
                       └────────────┬────────────────┘
                                    │ supabase-py (HTTPS to PostgREST)
                                    ▼
                       ┌─────────────────────────────┐
                       │   Supabase (PostgreSQL)     │
                       │   source of truth           │
                       └─────────────────────────────┘

                       ┌─────────────────────────────┐
                       │   Resend                    │  ← backend → SMTP/API
                       │   transactional email       │
                       └─────────────────────────────┘
                       ┌─────────────────────────────┐
                       │   Stripe Connect            │  ← backend → REST
                       │   payments + payouts        │
                       └─────────────────────────────┘
                       ┌─────────────────────────────┐
                       │   Privy                     │  ← frontend → SDK
                       │   auth (email OTP + Google) │     backend → JWKS
                       └─────────────────────────────┘
```

---

## Service-by-service

### 1. Vercel (frontend)

| Field | Value |
|---|---|
| Project name | dum-club (canonical) |
| Region | iad1 (Washington DC) |
| Production domain | `https://www.dum.club` |
| Build command | `next build` (default) |
| Output mode | App Router, hybrid (mix of static + dynamic) |
| Node version | Whatever Vercel autopicks for Next.js 14 |
| Source | `frontend/` directory of this repo |

**Critical env vars (Vercel Project Settings → Environment Variables, all `Production` scope):**

| Var | Why |
|---|---|
| `NEXT_PUBLIC_API_URL` | The Railway backend URL. Inlined into the client bundle at build time. Module load throws when this is empty in a production build (see `frontend/lib/apiBase.ts`) — silent fallbacks broke production before. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app id. MUST match `PRIVY_APP_ID` on Railway. Drift breaks JWKS verification. |
| `NEXT_PUBLIC_SITE_URL` | `https://www.dum.club` |
| `NEXT_PUBLIC_SENTRY_DSN` (optional) | Frontend Sentry |
| `NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD` | Default `39` (Starter base). Used by merchant page copy. |
| `NEXT_PUBLIC_ENABLE_SOL_CHECKOUT` | `false` until SOL is unlocked. |
| `NEXT_PUBLIC_ENABLE_IVS_REALTIME` | `false` until IVS is activated (see `docs/IVS_ACTIVATION.md`). |
| `NEXT_PUBLIC_SIMPLIFIED_DASHBOARD` | `false` (default) — flip to `true` to collapse dashboard settings into a single disclosure for simpler first-merchant UX. |

**Preview deploys:** every PR gets a Vercel preview. The backend's
CORS regex on `main.py` accepts `*-topgun-maintenances-projects.vercel.app`
and `dum-club*.vercel.app` so preview frontends can call production
backend during QA without a redeploy.

**Redirects** are configured in `frontend/next.config.js`:

| From | To | Status |
|---|---|---|
| `/explore` | `/discover` | 308 |
| `/ai-chat` | `/chat` | 308 |
| `/m/:slug` | `/project/:slug` | 308 |
| `/raise`, `/wefunder` | `/investors` | 308 |
| `/contact` | `/about#contact` | 307 (non-permanent so we can move it later) |
| `/for-business` | `/business` | 308 |
| `/become-a-merchant` | `/merchant` | 308 |

---

### 2. Railway (backend + crons)

One project, **five services** that share env:

| Service | Type | Cmd | Purpose |
|---|---|---|---|
| `api` | Web | `uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips '*'` (the Dockerfile default) | FastAPI app, listens on PORT |
| `trial_reminders` | Cron `0 9 * * *` ET | `python -m services.agents.trial_reminders` | T-14 / T-7 / T-1 trial countdown + past_due → suspended sweep |
| `live_reminders` | Cron `*/5 * * * *` UTC | `python -m services.agents.live_reminders` | Customer "they're going live now" emails |
| `schedule_rollforward` | Cron `0 * * * *` UTC | `python -m services.agents.schedule_rollforward` | Advance `projects.scheduled_live_at` by +7d for `recurring_weekly=true` |
| `merchant_recap` | Cron `0 9 * * 1` ET | `python -m services.agents.merchant_recap` | Weekly merchant recap email |

All five share the same Dockerfile (`backend/Dockerfile`). The cron
services should **reference variables from the `api` service** in
Railway so a single env var change propagates everywhere.

**Critical env vars (Railway Variables, applied to all 5 services unless noted):**

| Var | Required by | Notes |
|---|---|---|
| `PORT` | api only | Railway auto-injects. Cron services don't bind a port. |
| `SUPABASE_URL` | all | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | all | Service-role JWT for backend writes |
| `SUPABASE_ANON_KEY` | api only | Used by some public client paths |
| `PRIVY_APP_ID` | api | Same value as Vercel's `NEXT_PUBLIC_PRIVY_APP_ID` |
| `STRIPE_SECRET_KEY` | api | `sk_live_*` in prod, `sk_test_*` in test |
| `STRIPE_WEBHOOK_SECRET` | api | from Stripe webhook endpoint |
| `STRIPE_CONNECT_CLIENT_ID` | api | `ca_*` from Stripe Connect dashboard |
| `STRIPE_PRICE_ID_STARTER` / `_GROWTH` / `_PRO` | api + trial_reminders | Stripe price ids for $39 / $99 / $299 tiers |
| `RESEND_API_KEY` | api + trial_reminders + live_reminders + merchant_recap | Email send. Missing = sends skip silently. |
| `EMAIL_FROM` | same as RESEND_API_KEY | Default `DUM Club <orders@dum.club>`. Domain must be Resend-verified. |
| `NEXT_PUBLIC_SITE_URL` | api + email-sending crons | CTA links in email bodies. |
| `FRONTEND_URL` | api | Outreach unsubscribe link host. |
| `OUTREACH_UNSUBSCRIBE_SECRET` | api | 32+ char random string. Never rotate after first send. |
| `ENVIRONMENT` | api | `production` (gates test-only bypasses) |

`schedule_rollforward` does **not** need any email env vars — it only
touches Supabase.

**Health endpoints** (admin-gated) for verifying config without code:

- `GET /api/health` — public; reports the commit SHA + ok status
- `GET /api/health/checkout` — Stripe key/webhook/connect config
- `GET /api/health/email` — RESEND_API_KEY + EMAIL_FROM state
- `GET /api/health/solana` — DUM_MINT / DUM_TREASURY_KEYPAIR state
- `GET /api/health/dum` — DUM Points claim mode

---

### 3. Supabase (database)

| Field | Value |
|---|---|
| Project | DUM Club production |
| Database | PostgreSQL (managed) |
| Client | `supabase-py` 2.5.1 (HTTPS to PostgREST) — no direct Postgres pool |
| RLS posture | Most operator-only tables are RLS deny-all; service role bypasses. Public read tables enable RLS with explicit policies (see migrations 061-063). |

**Schema source of truth:** `backend/db/migrations/*.sql`, numbered.
Applied in order via `supabase db push` or by pasting into the
dashboard SQL editor. Latest applied migration when this doc was
written: **067_merchant_recap_log.sql**.

**Connection pattern:** the backend uses `supabase-py` over httpx
(PostgREST API), not a direct Postgres pool. There is no SQLAlchemy
or asyncpg in production. If a direct-Postgres path is ever added
via `DATABASE_URL`, it MUST use the **transaction pooler** host
(`pooler.supabase.com` port 6543), never the direct connection
(port 5432) — the direct connection limit saturates fast at scale.

**Where the data lives** (a non-exhaustive index of which tables
matter for which flows):

| Flow | Table(s) |
|---|---|
| Merchant signup | `merchants`, `users`, `profiles`, `business_profiles`, `accounts` |
| Stripe Connect | `merchants.stripe_connect_id`, `merchants.stripe_connect_status` |
| Projects (storefronts) | `projects`, `offers` |
| Live streaming | `stream_sessions`, `viewer_session_events`, `merchant_monthly_usage` |
| Orders | `orders` (status: pending/pending_payment/paid/fulfilled) |
| Reminders | `live_reminders`, `trial_reminder_log`, `merchant_recap_log` |
| Overage billing | `merchant_plan_limits`, `merchant_overage_invoices` |
| Outreach | `outreach_messages`, `outreach_leads` |

---

### 4. Resend (email)

| Field | Value |
|---|---|
| Sending domain | `dum.club` — must be Resend-verified |
| Default sender | `DUM Club <orders@dum.club>` (override via `EMAIL_FROM`) |
| Templates | Inline HTML in `backend/services/email.py` — one function per email type |
| Failure mode | Every `_send()` is wrapped in `try/except`; never blocks the surrounding flow |

If `RESEND_API_KEY` is missing, the email module logs
`[email] startup: RESEND_API_KEY is not set — email delivery DISABLED`
at boot and every send is a no-op. See
`docs/email-pipeline-audit.md`.

---

### 5. Stripe Connect (payments)

| Field | Value |
|---|---|
| Account type | Express (via OAuth) |
| Charge model | Direct charges (session created inside the connected account via `stripe_account` request option) |
| Platform fee | Read from `plan_limits.commission_rate` (1.00% on every tier after migration 054), applied via `application_fee_amount` |
| Override path | `merchants.commission_rate_override` (NULL by default; rate set explicitly per-merchant if non-NULL) |
| Webhook | `POST /api/checkout/webhook` on Railway. Idempotent — duplicate events return `{"received": true, "duplicate": true}` |

**No other payment processor.** CLAUDE.md §12 Rule 11: Stripe is
the ONLY payment processor. No Square, no PayPal, no GoDaddy.

---

### 6. Privy (auth)

| Field | Value |
|---|---|
| Sign-in methods | Email OTP + Google OAuth |
| Embedded wallets | Solana, auto-provisioned per signed-in user (not exposed in consumer UI today) |
| Backend verification | JWKS fetched at request time; audience must match `PRIVY_APP_ID` |
| App id | Production: `cmozwqkt600ho0dldrbcr6rwq` — never share with dev environments |

`NEXT_PUBLIC_PRIVY_APP_ID` (Vercel) and `PRIVY_APP_ID` (Railway)
MUST be the same value. Drift breaks every authenticated call with
"Token audience mismatch" (401).

---

### 7. Optional / dormant services

These have backend wiring but stay off until explicitly activated:

| Service | Flag to activate | Doc |
|---|---|---|
| AWS IVS Real-Time live streaming | `ENABLE_IVS_REALTIME_BACKEND=true` on Railway AND `NEXT_PUBLIC_ENABLE_IVS_REALTIME=true` on Vercel | `docs/IVS_ACTIVATION.md` |
| Solana on-chain DUM mint | `DUM_MINT` + `DUM_TREASURY_KEYPAIR` on Railway | `docs/billing-audit-2026-05.md` (claim flow) |
| Buyer-side SOL checkout | `NEXT_PUBLIC_ENABLE_SOL_CHECKOUT=true` + `SOL_CHECKOUT_QUOTE_HMAC_SECRET` | `.env.example` SOL block |

All three are deliberately gated behind feature flags so a missing
env var = safe no-op, not a runtime crash.

---

## Deploy sequence (what happens when you push to `main`)

1. **GitHub Actions** (none required today — `.github/` only holds
   reference workflows). Vercel + Railway each watch `main` directly.
2. **Vercel** picks up the push, builds the frontend, deploys to
   `https://www.dum.club`. Build time ~2-3 min. Atomic — old version
   keeps serving until new build is ready.
3. **Railway** picks up the push, rebuilds the backend Dockerfile,
   deploys the `api` service. Health checks run; old container
   keeps serving until the new one is healthy.
4. **Crons** auto-deploy with the api service when they share the
   same source. Each cron container is short-lived (one shot per
   schedule), so the next scheduled tick runs the new code.
5. **Migrations** do NOT auto-apply. You must paste them in the
   Supabase dashboard or run `supabase db push` from a workstation.
   See `docs/operator-launch-runbook.md` §1.

---

## Failure modes worth knowing

| Symptom | Likely cause | Where to look |
|---|---|---|
| 401 on every signed-in call | `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_ID` drifted | Vercel + Railway env vars |
| Storefront page shows "Untitled Project" | Frontend can't reach Railway | Network tab to API base, `NEXT_PUBLIC_API_URL` on Vercel |
| Emails not landing | `RESEND_API_KEY` missing OR domain not verified | `/api/health/email`, Resend dashboard |
| `/admin/operations` 500s | A column rename in `orders` or `stream_sessions` | Railway logs, look for PostgREST 400 |
| Cron didn't run | Service crashed or schedule wrong | Railway service status; cron uses 5-field syntax in UTC unless you set the TZ |
| Stripe webhook missed | Endpoint URL changed or secret rotated | Stripe dashboard → webhooks; replay via `stripe events resend <evt_...>` |
| New merchant can't see their dashboard | Profile upsert silently returning None (pre-fix `_resolve_owner_uuid`) | Railway logs, fixed in PR #293 |

---

## What this doc does NOT replace

- `docs/cron.md` — exact cron setup steps + manual test recipes
- `docs/email-pipeline-audit.md` — Resend audit + safe test recipe
- `docs/operator-smoke-checklist.md` — browser end-to-end checklist
- `docs/operator-launch-runbook.md` — first-launch infrastructure setup
- `docs/IVS_ACTIVATION.md` — IVS Real-Time activation runbook
- `docs/OBSERVABILITY.md` — Sentry + uptime monitor setup
- `docs/stripe-setup.md` — Stripe Connect wiring + price ids

Use those for HOW. This doc is for WHAT and WHERE.
