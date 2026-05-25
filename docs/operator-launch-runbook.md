# Operator launch runbook

Step-by-step for everything in `docs/final-launch-readiness.md` that
needs a real browser, real env vars, or real AWS/Stripe credentials
— the bits an autonomous agent can't do from a code sandbox.

Order matters. Do them top to bottom on first launch.

---

## 1. Apply pending migrations

```bash
# From backend/, with Supabase CLI configured to point at production:
supabase db push
```

What this applies (in this session's history):
- `046_scaling_indexes.sql` — **already applied & verified**.
- `047_replay_url.sql` — adds `replay_url` + `replay_recorded_at` to
  projects. Additive, safe; columns default to NULL on existing rows.

Each `CREATE INDEX CONCURRENTLY` must run **outside a transaction**
— the Supabase web SQL editor does this by default; psql may need
each statement run separately.

---

## 2. Set observability env vars

### Backend Sentry (Railway)

Create a project at sentry.io (Platform: Python / FastAPI). Copy the
DSN. On the Railway service:

```
SENTRY_DSN_BACKEND = <the DSN>
```

`sentry-sdk[fastapi]` is already in `requirements-prod.txt`. The
guarded init in `main.py` activates automatically (10% trace sample,
environment tagged from `RAILWAY_ENVIRONMENT`).

Verify: deploy, then trigger a known 500 (e.g. `curl
$BACKEND/api/health/database -H "Authorization: Bearer bad"`) and
confirm it appears in Sentry within ~30 s.

### Frontend Sentry (Vercel)

This requires installing a package — can't be done from the sandbox.

```bash
cd frontend
npx @sentry/wizard@latest -i nextjs
```

The wizard creates `sentry.client.config.ts`, `sentry.server.config.ts`,
`sentry.edge.config.ts`. Replace the generated configs with the
recommended setup in `docs/OBSERVABILITY.md` (10% trace, error-only
replay, `beforeSend` filter for `/api/health` and any stray "Stop
Claude" leakage). Then set on Vercel:

```
NEXT_PUBLIC_SENTRY_DSN = <frontend DSN>
SENTRY_AUTH_TOKEN      = <token from sentry.io>
SENTRY_ORG             = <org slug>
SENTRY_PROJECT         = <project slug>
```

Push the resulting commit; Vercel will source-map upload on deploy.
Verify by visiting `/dashboard` while throwing a manual error in
DevTools.

### Uptime monitor

Free account at uptimerobot.com → New Monitor:
- HTTP(s)
- URL: `<your NEXT_PUBLIC_API_URL>/api/health` (the Railway backend
  domain, not `www.dum.club`)
- Interval: 1 minute
- Alert after: 2 consecutive failures
- Notify: `julian@topgunmaintenance.com`

Optional second monitor at 5-minute interval against
`<backend>/api/health/ready` for deeper signal.

---

## 3. Validate `pending_payment` backlog

Once admin auth is verified:

```bash
curl "$BACKEND/api/health/orders-audit?owner_id=<topgun_owner_privy_id>" \
  -H "Authorization: Bearer <admin_token>"
```

Or use the **"Per-merchant order audit"** panel on `/admin/system` —
enter the owner's privy_id, hit "View audit." The response classifies
the 13 stuck rows:

- `with_no_stripe_ids` — likely pre-launch test rows. Safe to ignore
  or clean up manually.
- `with_stripe_session_id` (but no PI) — abandoned checkouts. Buyer
  didn't pay. **Don't run recovery on these.**
- `with_stripe_payment_intent_id` — webhook may have missed. **These
  are the candidates for** the existing `/recover-pending` button on
  the same page.

Click "Recover Orders" only after reviewing the audit.

---

## 4. The end-to-end smoke test (the actual launch gate)

Two devices/browsers, two accounts:

1. **Merchant side** (Topgun owner, signed in):
   - Open `/dashboard/post`.
   - Pick a real photo from the camera roll or take one.
   - Title + price.
   - Click "Post & Go Live" → expect the project page to load with
     the camera prompt firing within ~3s.
   - Allow camera. Expect "Connecting…" → "LIVE" within ~5s.

2. **Buyer side** (different account, new browser/incognito):
   - Open `/project/topgun-maintenance` **before** the merchant goes
     live.
   - Wait. Within ~15s of the merchant going live, the page should
     **auto-switch** to the LIVE banner (#233 — viewer polling).
   - Click the pinned offer. Use a real Stripe **test card**
     (`4242 4242 4242 4242`, any future expiry, any CVC).
   - Confirm the order completes; backend webhook flips status to
     `paid` within seconds.

3. **End stream** (merchant side):
   - Click End. AWS stage deletes (if on IVS — verify in AWS
     console), DB clears, viewer page shows ended state.

If anything fails: capture the URL, the exact click sequence, the
network tab, and file the symptom precisely. That's the next PR.

---

## 5. Lighthouse + mobile QA

On a real mobile device or DevTools mobile profile (390px and 430px):

### Lighthouse (any browser)

`pagespeed.web.dev` → enter `https://www.dum.club` → Analyze. Mobile
tab. Expect:
- LCP < 2.5s (deferred chunks from #227 should help)
- TBT under 200ms

Screenshot the report.

### Mobile responsiveness

Check on iOS Safari **and** Android Chrome:
- `/dashboard/post` — camera capture opens directly, decimal keyboard
  on price, sticky CTA above the on-screen keyboard.
- `/discover` — cards full-width on 390px viewport.
- `/project/topgun-maintenance` — content fills viewport edge to edge
  (post #231 fix).
- `/merchant` — "Talk to founder" tel: and mailto: links work.

If any of these fails on a real device, paste me the exact symptom +
viewport size + browser version and I'll PR the fix.

---

## 6. Verify the three redirects

Open in any browser:
- `https://www.dum.club/contact` → should land on About at the
  `#contact` section.
- `https://www.dum.club/for-business` → `/business`.
- `https://www.dum.club/become-a-merchant` → `/merchant`.

If any 404s, the `next.config.js` redirect block needs revisiting.

---

## 7. Stripe webhook CLI replay test (validates #225's atomic claim)

```bash
# In one terminal:
stripe listen --forward-to <BACKEND>/api/checkout/webhook

# In another:
stripe trigger checkout.session.completed
# Capture the evt_... id printed.

# Replay the same event:
stripe events resend <evt_...>
```

Expect the resend to return `{"received": true, "duplicate": true}`
and **not** re-fire side effects (no double DUM points, no double
email).

---

## 8. (Optional but useful) Activate IVS Real-Time

When you're ready to replace Mux:

1. Create AWS IAM user with the policy in `docs/IVS_ACTIVATION.md` §1.
2. Set on Railway: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_REGION=us-east-1`, `ENABLE_IVS_REALTIME_BACKEND=true`.
   Backend stays a no-op until the frontend flag flips.
3. Set `NEXT_PUBLIC_ENABLE_IVS_REALTIME=true` on a **Vercel preview
   branch only**. Run the 12 smoke tests in `docs/IVS_ACTIVATION.md` §3.
4. If all pass, flip the same env on Vercel production. Watch logs
   for 24h.
5. After ~2 weeks of clean IVS in prod, the Mux removal cleanup
   becomes safe (separate PR).

---

## 9. (Future) Clover integration

Blocked on registering a Clover sandbox app and obtaining client ID
+ secret + webhook signing secret. See `docs/` for the Clover audit
output (in the prior session). Foundation PR is ready to ship when
those credentials exist.

---

## What to do when something breaks

Capture in this order:
1. URL the user was on
2. Exact action taken (click X, then Y)
3. What was expected
4. What happened (screenshot, copy/paste error text, browser console
   output)
5. Browser + OS + viewport width if mobile

Open an issue or send the report — that's enough to scope the fix
PR precisely.
