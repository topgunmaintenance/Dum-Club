# Launch readiness — DUM Club

> **For pre-outreach launch today, use `docs/LAUNCH.md`** — single-page
> ordered checklist with copy-paste commands. This doc is the historical
> audit from 2026-05-16 (PR #234 era) and is retained for context, not
> as the current go-live path.

Final audit + merchant launch checklist. Updated `2026-05-16` after the
Phase 4 SIMPLIFIED_DASHBOARD merge. Once your manual Stripe + Railway
setup from `docs/stripe-setup.md` is done, this doc is the
go/no-go reference for inviting real merchants.

## TL;DR

| Dimension | Score | Notes |
|---|---:|---|
| UX simplicity | 9 / 10 | 6-step flow, plain English, walkthroughs on every action surface |
| Merchant onboarding (signup → ready to sell) | 9 / 10 | Privy sign-in, auto-claim seed profiles, Stripe Resume CTA, 5-step checklist |
| Stripe Connect (merchant payouts) | 9 / 10 | Full OAuth, webhook fan-out, status write-through |
| 60-day Stripe-managed trial | 9 / 10 | Customer + Subscription created on signup, no card required |
| Auto-conversion on day 60 | 9 / 10 | Stripe-owned. Webhook keeps merchants row in sync |
| Reminder emails (T-14 / T-7 / T-1 / convert / fail) | 9 / 10 | Daily cron + idempotent insert-log-then-send |
| Payment-failure grace period (3 days) | 9 / 10 | Suspension after grace, dashboard banner, gates Go Live + new orders |
| Founding-merchant exemption | 10 / 10 | Verified at three layers; SQL evidence below |
| Production deploy + smoke | not yet run | manual; see `docs/stripe-setup.md` §6 |

**Overall code-side readiness: 9 / 10.** The only step before active outreach is the manual Stripe + Railway + migrations + cron config from `docs/stripe-setup.md`.

---

## Final answer to the brief's closing question

> *"If I begin inviting real businesses tomorrow, can they sign up, understand the platform immediately, use it for 60 days free, and automatically convert to a paid subscription without manual intervention?"*

**Yes — once `docs/stripe-setup.md` is executed.**

Without that setup the trial system stays code-ready but unwired (no Price IDs in env → `create_trial_subscription` returns `error: "STRIPE_PRICE_ID_GROWTH not configured"` and signup degrades to a free-tier account, recoverable on next dashboard load).

---

## Phase ledger

| Phase | Outcome | PR | Merge SHA | Files |
|---|---|---|---|---|
| 0 — 60-day trial foundation | ✅ shipped | #205 | `d2b8ab8` | migration 043, `subscriptions.py`, `TrialCountdownBanner.tsx` |
| 1 — Reminder emails + cron | ✅ shipped | #206 | `ea59b72` | migration 044, `trial_reminders.py`, 5 templates in `email.py`, `docs/cron.md` |
| 2 — Grace period + suspension | ✅ shipped | #207 | `3df7b10` | migration 045, gates on Go Live + new orders, `is_merchant_suspended()` helper |
| 3 — Billing audit doc | ✅ shipped | #208 | `a1b27a7` | `docs/billing-audit-2026-05.md` |
| 5 — Homepage pricing summary | ✅ shipped | #208 | `a1b27a7` | hero copy + 3-column tier grid + "See full pricing" link |
| 6 — Stripe setup checklist | ✅ shipped | #208 | `a1b27a7` | `docs/stripe-setup.md` |
| 4 — Simplicity (rule edits) | ✅ shipped | #209 | `f674465` | dashboard eyebrow, ticker filter, pricing tier visibility |
| 4 — Simplicity (structural) | ✅ shipped | #210 | `a415ed1` | `NEXT_PUBLIC_SIMPLIFIED_DASHBOARD` flag + Settings disclosure |
| 7 — Production deploy | ⏸️ user manual | — | — | `docs/stripe-setup.md` §1-6 |

---

## Pre-launch verification SQL

Run these in Supabase SQL editor immediately after applying migrations
043/044/045 and before sending the first outreach link.

```sql
-- 1. Migrations applied
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'merchants' AND column_name = 'trial_ends_at'
) AS migration_043_applied;

SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_name = 'trial_reminder_log'
) AS migration_044_applied;

SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'merchants' AND column_name = 'grace_period_ends_at'
) AS migration_045_applied;

-- All three should return TRUE.

-- 2. Founding-merchant safety: every founding row must be grandfathered.
SELECT COUNT(*) AS founding_not_grandfathered
FROM merchants
WHERE founding_merchant = true AND grandfathered = false;
-- Expected: 0

-- 3. Founding rows have NO Stripe Subscription.
SELECT COUNT(*) AS founding_with_subscription
FROM merchants
WHERE founding_merchant = true AND stripe_subscription_id IS NOT NULL;
-- Expected: 0

-- 4. No founding merchant has ever received a trial-reminder email.
SELECT COUNT(*) AS founding_emails_sent
FROM trial_reminder_log trl
JOIN merchants m ON m.id = trl.merchant_id
WHERE m.founding_merchant = true;
-- Expected: 0
```

If any check fails, STOP. Do not begin outreach until the failing
check is fixed.

---

## Merchant launch checklist (for you to execute)

### Pre-flight (~25 min total)

- [ ] **Stripe Dashboard — create 3 Products + Prices** (Business optional)
      Per `docs/stripe-setup.md` §1. Recurring monthly USD: Starter $29,
      Growth $49, Pro $99. Copy each Price id (`price_…`). The $499
      Business plan is intentionally NOT auto-provisioned and is not
      read by any code path today — defer creating it until a real
      custom-quote merchant signs up via the `mailto:` CTA on `/pricing`.

- [ ] **Stripe Dashboard — webhook endpoint**
      Per `docs/stripe-setup.md` §2. Endpoint URL points at Railway
      backend `/api/checkout/webhook`. Subscribe the six subscription
      events listed there. Copy the `whsec_…` signing secret.

- [ ] **Railway backend service — env vars**
      Set `STRIPE_PRICE_ID_STARTER`, `_GROWTH`, `_PRO`, plus
      `STRIPE_WEBHOOK_SECRET`. Confirm `RESEND_API_KEY` and
      `STRIPE_SECRET_KEY` are present. Leave `STRIPE_PRICE_ID_BUSINESS`
      unset for launch. Redeploy.

- [ ] **Apply migrations 043, 044, 045** in Supabase SQL editor (in order).

- [ ] **Run the verification SQL above** — all four checks pass.

- [ ] **Railway cron service** per `docs/cron.md` and `docs/stripe-setup.md` §5.
      Schedule: `0 9 * * *` America/New_York. Command:
      `python -m services.agents.trial_reminders`. Inherit env from API service.
      Manual test from cron shell:
      ```
      python -m services.agents.trial_reminders
      ```
      Output should show `done. sent total=0`.

- [ ] **Run the 7-step production smoke test** from `docs/stripe-setup.md` §6
      end to end. Each step has a pass condition; do not skip.

### Outreach window (after pre-flight is 100% green)

- [ ] **Pick first 3 merchants.** Local-radius friends, low-stakes test
      cohort. Send them the storefront link + a one-paragraph
      "what you'll see" preview.

- [ ] **Watch for 24 hours.** Monitor:
  - Stripe Dashboard → Subscriptions → Trialing count incrementing
  - Supabase → `merchants` table → new rows with `trial_ends_at` ~60d
    out, `subscription_status='trialing'`
  - Railway backend logs → no `[merchant/signup] trial provisioning
    skipped` lines (those mean Stripe call failed)
  - Resend dashboard → no bounced emails

- [ ] **First real Stripe transaction.** When one of the three merchants
      lands their first paid customer order via Stripe Connect, you've
      cleared Phase 0B from `CLAUDE.md` §6 and unlocked Phase 1.

### Scaling

- [ ] **Day 14 of any merchant's trial.** Confirm the T-14 reminder
      email arrived (check Resend dashboard or `trial_reminder_log`
      table for a `t_minus_14` row).

- [ ] **Day 60 of any merchant's trial.** Confirm:
  - If a payment method is on file → Stripe charges, `invoice.paid`
    webhook arrives, `subscription_status` flips to `active`,
    conversion-confirmed email lands.
  - If no payment method → Stripe pauses, `subscription_status` becomes
    `paused`, dashboard banner reads "Your plan is paused".

- [ ] **First failed payment in production.** Confirm the 3-day grace
      flow works end-to-end:
  - `subscription_status='past_due'` immediately
  - `grace_period_ends_at = now + 3d` populated
  - Email arrives with the grace-end date
  - Dashboard banner shows the same date + "Update Payment Method →" CTA
  - 3 days later, daily cron flips status to `suspended`
  - Suspended merchant: Go Live and new orders return 402

---

## What to do if something goes wrong

| Symptom | First thing to check |
|---|---|
| New signup has `stripe_subscription_id IS NULL` | Railway logs for `[merchant/signup] trial provisioning skipped: ...` — usually missing `STRIPE_PRICE_ID_GROWTH` env |
| Trial banner not rendering on `/dashboard` | `/api/merchant/trial-status` response in browser devtools — confirm `has_subscription=true` and `grandfathered=false` |
| No reminder email at T-14 | Check `trial_reminder_log` for the row first; if it exists, the issue is Resend (key not set, sender not verified). If no row, the cron didn't run |
| Stripe webhook events not landing | Stripe Dashboard → webhook endpoint → Recent events → look for 4xx/5xx |
| Founding merchant accidentally received a reminder | Run the verification SQL §2-§4 above. If `founding_not_grandfathered > 0`, re-run the migration 043 backfill |
| Suspended merchant can still Go Live | Confirm `subscription_status='suspended'` in DB, then check `/api/ivs/create-stage` returns 402 (not 200) |

---

## What is NOT in scope for this launch

These are explicitly deferred and **safe to leave alone**:

- Phase 4 per-page copy rewrites — held with founder per "current copy as-is"
- DUM Points purchase flow (legal review pending — `CLAUDE.md` §5)
- Solana on-chain claim (Phase 3+ unlock)
- AWS IVS scaling beyond ~50 concurrent hosts (re-evaluate at Phase 1 ladder)
- check:human-copy banned-word list extension for Phase 4 vocabulary
- B2B white-label tier (`Business` $499 — built but hidden behind disclosure on `/pricing`)

---

## Sign-off

When every checkbox under "Pre-flight" + the 7-step smoke test in
`docs/stripe-setup.md` §6 is green, DUM Club is **production-ready
for active merchant outreach**. The trial → auto-convert → grace →
suspension flow runs without manual intervention from that point on.
