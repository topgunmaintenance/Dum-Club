# Survival mode — operational risk register

What could kill DUM Club between today and 100 paying merchants. One-page
operator reference. Each row has a current mitigation, a residual risk
score (low / medium / high), and the next concrete action (none, ship,
or operator-config).

**Last updated:** 2026-05-27.
**Review cadence:** every 10 paying merchants until 100; then quarterly.

---

## 1. Production data loss

| Risk | Mitigation today | Residual | Next action |
|---|---|---|---|
| Supabase Postgres DB corruption / accidental DELETE | Supabase Pro tier includes point-in-time recovery (PITR) for last 7 days | low IF Pro tier is active | **Operator-verify:** Supabase dashboard → Project Settings → Billing — confirm plan is `Pro` (not Free). Free tier has only daily snapshots, no PITR. |
| Service-role key leak | Env vars only (Railway), never in source tree | low | grep `SUPABASE_SERVICE` returns only ENV reads in code |
| Backup retention insufficient at scale | 7-day PITR + daily snapshots is fine through ~1,000 merchants | low | reconsider when DB > 50 GB |
| Migration goes wrong | Every migration has a rollback companion in `backend/db/migrations/rollback/` | low | enforced by convention; no DDL ships without rollback |

---

## 2. Production outage

| Risk | Mitigation | Residual | Next action |
|---|---|---|---|
| Railway region iad1 down | Single region today | medium | **Document:** Railway doesn't offer multi-region for our tier. Acceptable until 1,000+ merchants. Plan: at that point, audit AWS-direct deploy + multi-region. |
| Vercel region down | Single region (iad1) | medium | same as above; both Vercel + Railway in iad1 by design (same coast = lower hop latency) |
| Mux outage during a live | merchant's stream halts; viewers see "Connecting..." | medium | **Mitigation in flight:** AWS IVS Real-Time activation gives us a second pipeline. See `docs/IVS_ACTIVATION.md`. |
| Resend outage | Order confirmation + reminders fail; everything else keeps working | low | every send is try/except; never blocks the surrounding flow (see `docs/email-pipeline-audit.md` §"Failure modes") |
| Stripe webhook missed | Order stuck in `pending_payment` | medium | **Recovery exists:** admin operations page has "Recover Orders" button + `/api/health/orders-audit` endpoint. Documented in `docs/operator-launch-runbook.md` §3. |
| Privy outage | Sign-in fails | high | no fallback today. Sign-in is single-vendor. **Accept** — switching providers mid-flight is more risk than the residual outage probability. |

### One-time action: set up an external uptime monitor

UptimeRobot free tier:
- HTTPS monitor on `https://<backend>/api/health`
- Interval 1 min, alert after 2 consecutive failures
- Email + SMS alert to operator

Without this, a Railway crash at 3am is invisible until a merchant complains. ~5 min to set up.

---

## 3. Scaling risks (through 100 merchants)

| Risk | Mitigation | Residual | Next action |
|---|---|---|---|
| DB query patterns thrash at scale | `docs/RLS_PERF_TODO.md` audit found no policy-level scale problems. Service-role bypasses RLS on hot paths. | low | already audited |
| Email rate limits on Resend | Resend's per-domain limits are above our send volume through 100 merchants | low | revisit at 1k+ active merchants |
| IVS viewer-hour cost runaway | viewer-hour overage billing (migration 060) caps merchant exposure + no-double-bill rule (CLAUDE.md §3) | low | monitor monthly `merchant_monthly_usage` aggregation |
| Stripe webhook spike | Idempotent webhook handler (PR #225); duplicate events return `{received: true, duplicate: true}` | low | replay-tested in `docs/operator-launch-runbook.md` §7 |
| Single-process API serving everything | Railway api service runs uvicorn with workers=1 today | low until ~50 concurrent users | bump to `--workers 2` once traffic warrants; container memory limits will tell us when |

---

## 4. Merchant churn risks

| Risk | Mitigation today | Residual | Next action |
|---|---|---|---|
| Merchant goes live once, never again | Weekly recap email; ScheduleNextLiveCard always visible on dashboard | medium | consider milestone celebration after first sale (small UI add) |
| Merchant signs up, never connects Stripe | Trial-period reminder cron (T-14/7/1) keeps them from forgetting | low | already shipped |
| Stripe Connect onboarding abandonment | Friendly error copy + retry button (#218); 60-day trial doesn't require card | low | already shipped |
| First-time merchant confused by 6-step checklist | Step 5 (website snippet) now marked optional with skip path for businesses without websites | low | shipped today |
| Merchant in slow week feels punished by recap email | Empty-state copy ("Lives are how customers find you. Pin an offer and schedule next week's slot in one tap.") never says "you did nothing" | low | shipped today |

---

## 5. Pricing model risks

| Risk | Mitigation | Residual | Next action |
|---|---|---|---|
| Merchant under-pays IVS cost (loss-leader risk) | Viewer-hour overage billing (migration 060); commission floor at 1.5% on all tiers (CLAUDE.md §3) | low | accept low margin on the loss-leader Starter tier as customer-acquisition cost |
| Merchant hits unlimited viewer count (cost explosion) | Per-tier concurrent-viewer ceilings (250/600/2000) enforced server-side at token mint time | low | already shipped |
| Single high-GMV merchant suddenly stops paying | No mitigation today; manual recovery + reach-out | medium | accept; reach out personally if a Pro merchant misses a renewal |
| 1.5% commission balance vs margins | CLAUDE.md §12 Rule 1 doctrine-locks the 1.5% cap | accepted | the pitch is "industry-low 1.5% (vs Whatnot 8%)". Exceeding it requires a doctrine update. |

---

## 6. Trust risks

| Risk | Mitigation | Residual | Next action |
|---|---|---|---|
| Resend `dum.club` domain not verified | Sends will all reject until verified | high until verified | **Operator action:** `docs/LAUNCH.md` step 4. Verify in Resend dashboard. |
| Production status page absent | Customers / merchants discover outages by experience, not announcement | medium | UptimeRobot's public status page is free; ~5 min to set up + share link in footer |
| No incident communication channel | If something breaks, merchants have no email/blog they trust | low through 100 merchants | revisit at scale; for now Julian's email is the channel |
| DUM Points framed as investment in any surface | Doctrine sweep clean post-PR #294 (buyer emails fixed); SiteFooter legal blurb explicitly denies investment framing | low | already shipped |
| Stripe processing fee surprise | UI explicitly states buyer pays processing | low | already shipped |

---

## 7. Legal / compliance exposure

| Risk | Mitigation | Residual | Next action |
|---|---|---|---|
| GDPR / CCPA for buyer emails | All buyer emails are transactional (purchase confirmation / order fulfilled / reminder for opt-in subscription). No marketing without explicit opt-in. | low | document in privacy policy if not already there |
| CAN-SPAM unsubscribe on outreach | Every outreach email includes a signed unsubscribe link (`backend/services/email.py` `_unsubscribe_url`) | low | already shipped |
| DUM Points security framing | CLAUDE.md §5 forbids investment / token framing. PR #294 fixed two leaks. | low | already shipped |
| Stripe Connect terms compliance | We use Express accounts (Stripe-managed identity review); platform takes commission via `application_fee_amount` per Stripe's intended pattern | low | standard Stripe Connect pattern |
| Storing buyer PII | We store buyer email on `orders` and `live_reminders`. Both tables have RLS deny-all by default. | low | already shipped |

---

## 8. Onboarding drop-off causes (ranked by suspected impact)

| Drop-off point | Mitigation | Residual | Next action |
|---|---|---|---|
| Privy sign-in OTP didn't arrive | Privy retries automatically; user can request resend | low | accept (vendor-managed) |
| Stripe Connect OAuth state mismatch | All known error codes have friendly copy + retry button (`/merchant` `stripeErrorCopy`) | low | already shipped |
| Merchant "I don't have a website" friction | Step 5 marked optional with skip path | low | shipped today |
| Merchant doesn't know what to post first | `GetLiveSteps` + post page have prompts; `/business` page shows examples | medium | could add 3-5 example offer templates ("$X minimum delivery", "Today's special $Y", etc.) — small UI add, not blocking |
| Merchant tries Go Live on a device without camera | Friendly error UI (`no_device` kind) | low | already shipped (`IVSStageHost.tsx` line 461) |

---

## 9. Retention failure points

| Failure point | Mitigation | Residual | Next action |
|---|---|---|---|
| Customer signs up for "Remind me" but reminder never lands | Cron runs every 5 min with atomic-claim dedup | low | already shipped |
| Merchant lets `scheduled_live_at` go stale (past time) | schedule_rollforward cron auto-advances for `recurring_weekly=true` merchants | low | already shipped |
| Buyer doesn't see they earned DUM Points | Reward email sent on purchase + Points visible on `/hub` | low | already shipped |
| Merchant doesn't realize they have repeat customers | Drive Your Market analytics (Growth+) shows it; Starter tier doesn't | accepted | Starter merchants upgrade to Growth to see this; that's the pitch |

---

## 10. Tax / accounting exposure

| Risk | Mitigation | Residual | Next action |
|---|---|---|---|
| 1099-K reporting for connected accounts | Stripe Connect issues 1099-K automatically per their Connect rules | low | vendor-managed |
| Platform's own tax obligation on commission revenue | We collect commission via `application_fee_amount`; this is platform revenue and must be reported by the operator | medium | **Operator action:** confirm CPA / accountant has a quarterly process for the platform revenue line. Not a code concern. |

---

## Top 3 priorities right now

The directive asks for ranked risks. Across all 10 categories above, the three concrete items the operator should action this week:

1. **Verify Supabase plan is Pro** (data-loss insurance — `docs/LAUNCH.md` mentions it indirectly; not a code action)
2. **Verify Resend `dum.club` domain** (operator dashboard action; `docs/LAUNCH.md` step 4)
3. **Set up UptimeRobot on `/api/health`** (5 min, free; documented in `docs/OBSERVABILITY.md`)

After those three, every other risk in this register is either already mitigated in code or has a documented next action that's not blocking active merchant outreach.

---

## What this doc explicitly accepts

These are known residual risks the operator is choosing to accept until scale forces a revisit:

- **Single-region Vercel + Railway** (acceptable until 1,000+ merchants)
- **Privy as single-vendor sign-in** (acceptable; switching mid-flight is more risk than the residual outage probability)
- **No clip generator / no RTMP simulcast** (acceptable; see `docs/social-distribution-plan.md`)
- **1.5% commission cap** (doctrine, not a risk — CLAUDE.md §12 Rule 1)
