# Browser smoke test — pre-outreach operator checklist

Final hands-on checklist before active merchant outreach. Two devices
(desktop + phone), two browsers (a signed-in operator + an incognito
buyer). Walk top-to-bottom. Every line is a single, verifiable
behavior — if it doesn't work, stop and fix before sending the next
outreach email.

Last updated: 2026-05-27.
Reference docs:
- `docs/operator-launch-runbook.md` — first-launch infrastructure setup
- `docs/cron.md` — Railway cron configuration
- `docs/email-pipeline-audit.md` — Resend / RESEND_API_KEY readiness

---

## Pre-flight

Before opening any browser:

- [ ] `/api/health` returns `ok: true` and the commit matches `git log -1 main`
- [ ] `/api/health/email` returns `enabled=true, key_set=true` (see `docs/email-pipeline-audit.md`)
- [ ] `/api/health/checkout` returns `status=healthy` (Stripe keys + webhook)
- [ ] Railway: API service status is **Active**, not Crashed/Restarting
- [ ] Railway: three cron services exist (`trial_reminders`, `live_reminders`, `schedule_rollforward`) — each shows a recent successful run line in logs
- [ ] Vercel: latest production deploy SHA matches `git log -1 main`

If any of these fail, stop and fix.

---

## 1. Login

Desktop (signed-in operator session).

- [ ] Open `https://www.dum.club`
- [ ] Click **Sign in** in the navbar
- [ ] Privy modal opens
- [ ] Use email OTP with `jmero1@gmail.com`
- [ ] OTP arrives in inbox within 30s
- [ ] Paste OTP → modal closes → navbar shows account chip / avatar
- [ ] Browser cookie set, refreshing the page keeps the session

Expected: home page shows the buyer-facing surface (live grid / search),
NOT redirected to `/auth` or `/dashboard`.

---

## 2. Dashboard shows both projects

- [ ] From the navbar/account menu, click **Dashboard**
- [ ] URL becomes `/dashboard`
- [ ] Page hydrates within ~2s; no spinner stuck

Expected projects visible in the dashboard project switcher (canonical
account migration 057, two active projects under one LLC):

- [ ] **Topgun Maintenance LLC** appears
- [ ] **Silver Market Hub** appears
- [ ] Switching between them updates `pinned_offer_id`, scheduling
      card, and Get-Live checklist state

If only one shows up: the account/business_profile rebinding in
migration 057 didn't land for this Privy DID. See
`docs/operator-launch-runbook.md` §2b — verify the seed_claim
rebound under Julian's DID, not the seed placeholder.

---

## 3. Schedule a livestream

Still on `/dashboard`, with the Topgun project selected.

- [ ] Scroll to **Schedule next live** card (`ScheduleNextLiveCard`)
- [ ] Pick a time **2-3 minutes in the future** (this matters — the
      reminder cron window is `[now-15m, now+6m)`)
- [ ] Toggle **Repeat weekly** ON
- [ ] Click **Save**
- [ ] Card flips to a "Saved" / "✓" state
- [ ] Banner: navigate to `/project/topgun-maintenance` in a new tab.
      The "📅 Going live <day at time>" banner shows the time you just set.

Verify in Supabase (optional but conclusive):

```sql
SELECT id, name, scheduled_live_at, recurring_weekly
FROM projects
WHERE slug = 'topgun-maintenance';
```

Both columns should match what you just saved.

---

## 4. Customer taps "Remind me"

Open `https://www.dum.club/project/topgun-maintenance` in a **different
browser** or incognito window (the customer must not be signed in as
the merchant).

- [ ] "📅 Going live <day at time>" banner is visible at the top of
      the storefront
- [ ] Email input + "Remind me" button visible to the right (or
      stacked on mobile)
- [ ] Type `jmero1+remindtest@gmail.com` (`+remindtest` makes it
      easy to filter the inbox; routes to the same Gmail)
- [ ] Click **Remind me**
- [ ] Button flips through "Saving…" → green "✓ We'll email you when
      the show starts."

Network tab verification:
- [ ] `POST /api/projects/topgun-maintenance/live-reminders` returns 200
- [ ] Response body: `{ ok: true, ... }`

---

## 5. Reminder row saves in DB

In Supabase SQL editor:

```sql
SELECT id, project_id, customer_email, scheduled_for, sent_at, created_at
FROM live_reminders
WHERE customer_email = 'jmero1+remindtest@gmail.com'
ORDER BY created_at DESC LIMIT 1;
```

- [ ] Exactly one row returned
- [ ] `scheduled_for` matches the time set in §3
- [ ] `sent_at` is **NULL**
- [ ] `project_id` matches Topgun's UUID

---

## 6. live_reminders cron sends correctly

Tail logs on the `live_reminders` Railway cron service.

When the wall clock crosses `scheduled_for - 6 min`:

- [ ] Log line: `[live-reminders] window=[...,...) scanned=1 claimed=1 sent=1 errored=0`
- [ ] Log line: `[email] sent to=jmero1+remindtest@gmail.com subject='Topgun Maintenance LLC is going live now' id=re_...`
- [ ] Email lands in `jmero1@gmail.com` inbox within 30s
- [ ] Sender shows as `DUM Club <orders@dum.club>` (or your configured
      `EMAIL_FROM`)
- [ ] Subject reads `<business name> is going live now`
- [ ] "Watch now →" button links to `https://www.dum.club/project/topgun-maintenance`

Verify duplicate protection — re-run cron manually OR wait for the
next 5-min tick:

- [ ] Second tick log: `[live-reminders] window=[...,...) — 0 due`
- [ ] No second email lands

Re-check the row:

```sql
SELECT sent_at FROM live_reminders
WHERE customer_email = 'jmero1+remindtest@gmail.com'
ORDER BY created_at DESC LIMIT 1;
```

- [ ] `sent_at` is now non-NULL

---

## 7. recurring_weekly auto-rolls correctly

This requires the wall clock to be **past** the scheduled time you
set in §3. Wait until `scheduled_live_at` is in the past, then trigger
the schedule_rollforward cron.

Option A — wait for the hourly tick. Option B — manual run via a
Railway one-off shell:

```bash
cd /app
python -m services.agents.schedule_rollforward
```

- [ ] Log line: `[schedule-rollforward] now=... scanned=1 rolled=1 errored=0`

Verify in Supabase:

```sql
SELECT scheduled_live_at FROM projects WHERE slug = 'topgun-maintenance';
```

- [ ] Returned timestamp is strictly in the future
- [ ] The new value equals the original `scheduled_live_at` + N×7 days
      where N is the smallest positive integer landing in the future

Refresh `/project/topgun-maintenance` in the buyer tab:

- [ ] Banner now shows the new (next-week) scheduled time, NOT
      "going live yesterday"

---

## 8. Go live / end live

Back on the merchant dashboard (signed-in operator browser).

Go live:
- [ ] Click **Go Live** on the dashboard or storefront-manage page
- [ ] Browser prompts for camera permission → allow
- [ ] "Connecting…" overlay appears, then flips to **LIVE** within ~5s
- [ ] Project page renders local camera preview (operator side)

Buyer side (incognito tab on `/project/topgun-maintenance`):
- [ ] Within ~15s, the page auto-flips from "Going live" banner to
      LIVE state (banner replaced by live player + pinned offer)
- [ ] Live player loads without an error overlay

End live:
- [ ] Operator clicks **End**
- [ ] Operator side: live UI tears down, returns to dashboard state
- [ ] Buyer side: within ~15s, page shows ended state (no broken
      player, no infinite spinner)
- [ ] Tap-to-retry on the ended state surfaces a retry CTA (PR #290)
- [ ] Tapping retry re-queries `/api/projects/topgun-maintenance` and
      either re-renders the live state (if back live) or stays on
      the ended state (no error toast)

Verify in DB:

```sql
SELECT id, name, is_live FROM projects WHERE slug = 'topgun-maintenance';
```

- [ ] `is_live = false`

---

## 9. Sticky offer works on mobile

On a real iPhone (or DevTools mobile profile at 390×844):

- [ ] Open `https://www.dum.club/project/topgun-maintenance`
- [ ] Pinned offer strip is visible at the bottom of the viewport
- [ ] Strip stays pinned to the bottom while scrolling the page
- [ ] Strip respects safe-area-inset-bottom on a notched device — no
      part is hidden behind the home indicator
- [ ] Tapping the offer opens checkout (does NOT scroll the page out
      from under)

Repeat the same checks during a live stream (operator goes live in
parallel):

- [ ] Pinned offer strip remains visible above the live player chrome
- [ ] No double-bottom-bars (mobile safe area was the bug in PR #286
      — confirm it's still fixed)

---

## 10. Stripe checkout charges 1.5% fee

On the buyer side (incognito), with the merchant signed in on the
other browser:

- [ ] Pin a $2.00 offer in the merchant dashboard (set price = 2.00). Use $2.00 (not $1.00) so 1.5% is an exact $0.03 — on $1.00 it would be 1.5 cents, which rounds half-up to $0.02.
- [ ] Buyer reloads `/project/topgun-maintenance` — sticky offer
      shows the $2.00 item
- [ ] Buyer taps the offer → Stripe checkout opens
- [ ] Use test card `4242 4242 4242 4242`, any future expiry, any CVC
- [ ] Checkout completes → buyer lands back on storefront with
      `?checkout=success` toast (PR #283 — instant top-of-viewport)

Verify the platform fee on the Stripe dashboard:
- [ ] **Connected account → Topgun** → Payments → latest PaymentIntent
- [ ] Amount: $2.00
- [ ] Application fee: **$0.03** (1.5% of $2.00)
- [ ] Net to merchant: $1.97 minus Stripe processing fee

Verify in DB:

```sql
SELECT id, amount_total, status, stripe_payment_intent_id, created_at
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC LIMIT 1;
```

- [ ] Latest paid row has `status='paid'`, `amount_total=200` (cents)
- [ ] `stripe_payment_intent_id` is non-null

If the application fee is anything other than $0.03: STOP. The
commission resolution path in `backend/services/commission.py` is
broken — do not send a single outreach email until this is fixed.
Commission accounting is the platform's only revenue stream besides
subscriptions; any drift is a profitability emergency.

Confirmation emails:
- [ ] Buyer confirmation email lands in inbox (subject: "You bought
      on Dum Club 🚀 + You earned DUM")
- [ ] Merchant new-sale email lands in operator inbox (subject:
      "You made a sale 🔥 — <offer title>")

---

## 11. Operations dashboard shows activity

Sign in as the operator. Navigate to `/admin/operations` (requires
`users.is_admin = true` — see operator-launch-runbook.md §2b).

- [ ] Page loads, no 401/403
- [ ] Active streams table shows the just-ended Topgun stream
      (or empty if you ended >2 minutes ago — this is expected)
- [ ] This month usage card shows non-zero `viewer_hours` and a
      `stream_count >= 1`
- [ ] Stripe fees (30d) card shows the $0.03 platform fee from §10
      (or close to it depending on prior test transactions)
- [ ] Recent streams (7d) shows at least 1 stream
- [ ] Page auto-refreshes every 30s (watch the "as_of" timestamp tick)

If any card shows "—" or "0" when you know there was activity:
- Check `/api/admin/operations/overview` directly in the network tab
- The card aggregations live in `backend/api/routes/admin.py` — log
  output will name the failing aggregation

---

## What to do when something fails

Capture, in order:
1. URL the issue happened on
2. Exact action (click X, then Y)
3. Expected behavior (this checklist line)
4. What actually happened (screenshot + browser console + network
   request/response)
5. Device + viewport (iPhone 14 Safari, 390×844, etc.)
6. Whether the same issue reproduces in a different browser

Stop the outreach until the issue is resolved — every line here is
a thing a real local-business owner will hit on their first session.
A broken pinned offer or a missing live banner during outreach is
worse than no outreach.

---

## Post-checklist clean-up

After the test passes end-to-end:

```sql
-- Remove the test reminder row so it doesn't clutter prod data
DELETE FROM live_reminders WHERE customer_email = 'jmero1+remindtest@gmail.com';

-- Optional: reset Topgun's recurring_weekly if you only had it on for the test
UPDATE projects SET recurring_weekly = false WHERE slug = 'topgun-maintenance';
```

Leave the $1.00 test order in `orders` — it counts as the Phase 0B
unlock condition (one real `status='paid'` row) and proves the
Stripe path works end-to-end.

---

## Pass / fail decision

**Pass:** every box above is checked. Active merchant outreach is
safe to begin.

**Fail:** at least one box is unchecked AND that box is one of:
- §6 (cron sends reminders)
- §8 (go-live / end-live)
- §10 (Stripe charges 1.5% correctly)
- §11 (ops dashboard reads correctly)

Any of those four failures = stop outreach until fixed. A
non-blocking fail in §9 (mobile sticky offer) is recoverable in a
same-day PR; the rest are blockers.
