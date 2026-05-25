# DUM Club — launch readiness assessment

**Honest synthesis** of what's shipped, what's at risk, and what's
needed before going broad to merchants. Based on the actual code
state in `main` as of PR #234, **not** on simulated audit runs. No
fabricated screenshots or latency numbers — those have to come from
real-browser testing (see operator runbook).

## Confidence scores

| | Score | Reason |
|---|---|---|
| **Production stability** | **B+** | Solid foundation. One real outage this session (the `Optional` crash loop, fixed in #226) was caused by `py_compile`-only verification of backend code; smoke-import guard now closes that hole at the image-build step. No other unrecovered incidents. |
| **Merchant readiness** | **C+** | Path is clear (signup → connect Stripe → Post & Go Live), but **no real merchant has done a real live sale end-to-end in this session**. The Topgun project page renders, 17 orders exist, but 13 are `pending_payment` (likely abandoned checkouts — read-only audit endpoint shipped in #231 to verify). |
| **Buyer trust signals** | **B** | Founder note + phone + email visible. Fee tooltip dynamic (#232). "Checkout not completed" honest labeling (#232). Empty states are clean. |
| **Launch confidence** | **C** | Not blocked, but the gap between "code looks right" and "merchant cuts a live show, gets paid, ships product, sees a happy customer" hasn't been crossed in this session. |

## What's shipped (this session — 22 merged PRs)

### Clarity / trust pass (#213–#219)
1. Global nav, redirects, copy swap, ticker scoping (#213)
2. Solana removal from merchant-facing pages (#214)
3. Homepage restructure, 3-step How It Works, CTA reduction, founder trust row (#215)
4. Pricing FAQ, about bullets + #contact, discover empty state (#216)
5. Project-page empty state + merchant signup expansion (#217)
6. Investors reachability, technology reorder, mobile focus trap, unique H1s (#218)
7. /business FAQ + discover/merchant gap-fills (#219)

### Scaling roadmap (#220–#225)
8. Frontend perf: right-sized skeletons + loading caption (#220)
9. Backend N+1 elimination: single `/api/projects/discover` (#221)
10. DB indexes migration + RLS audit + pooler doc (#222)
11. Caching layer: ISR + backend TTL + asset headers (#223)
12. Observability scaffold: readiness + admin metrics + **guarded** Sentry backend init (#224)
13. Stripe webhook atomic-claim idempotency (#225)

### Operational
14. Hotfix: `Optional` import in `health.py` + Docker build-time smoke import guard (#226)
15. Homepage LCP/TBT — defer below-the-fold chunks + drop Solana SDK from bundle (#227)
16. Go Live perceived-latency: optimistic UI + parallel backend reads (Mux path) (#228)
17. IVS activation prework: orphan-stage cleanup + activation runbook (#229)
18. Dashboard UX: "Post & Go Live" composer + collapsed advanced + copy renames (#230)
19. Production-validation fixes: mobile width + dashboard count + Go Live cleanup + fee tooltip + read-only orders audit (#231)
20. Polish: dashboard LIVE counter + "Setup & Stats" + dynamic fee tooltip + abandoned-checkout label (#232)
21. IVS Go Live reliability: viewer + embed bubble auto-refresh + parallel `/create-stage` reads (#233)
22. Replay foundation: column + endpoint + display path (this PR — #234)

## What's verified vs not

| Capability | Code in place | Real test | Status |
|---|---|---|---|
| Stripe checkout end-to-end | yes | not in this session | **needs operator** |
| Webhook atomic-claim under load | yes | not in this session (no CLI replay) | **needs operator** |
| Mux live broadcast (current active path) | yes | not in this session | **needs operator** |
| IVS live broadcast | yes (dormant) | smoke tests in `docs/IVS_ACTIVATION.md` | **needs operator** |
| Replay display | yes (this PR) | column NULL on all rows; nothing to display yet | **dormant scaffold** |
| Frontend perf (LCP/TBT) | improved in #220, #227 | PageSpeed run never done in this session | **needs operator** |
| Mobile responsiveness | static-fixed in #220, #231 | iOS Safari / Android Chrome real-device QA never done | **needs operator** |
| Discover empty / no-merchants state | yes (#216) | UI verified via build, not in browser | partial |
| Admin orders audit (read-only) | yes (#231) | not exercised against real production data | **needs operator** |
| Backend Sentry | code present, **guarded** (no-op without DSN) | DSN never set on Railway | **needs operator env** |
| Frontend Sentry | **not installed** | n/a | **needs operator** (`npx @sentry/wizard`) |
| Uptime monitoring | doc only | n/a | **needs operator** (UptimeRobot setup) |
| Migration `046` (scaling indexes) | written, **applied & verified** in user's Supabase | yes | ✓ done |
| Migration `047` (replay scaffold) | written | not applied | **needs operator** (`supabase db push`) |

## Remaining risks

🔴 **Real-world end-to-end never run.** The most serious risk: nobody
has cut a real live show with a real merchant + real buyer + real
Stripe charge in this session. Everything below `/api/checkout/*` and
`/api/ivs/*` has been verified at the *code* level. Production
behavior is an inference, not an observation.

🔴 **`pending_payment` backlog on Topgun.** 13/17 orders. Read-only
audit endpoint shipped (#231); the operator hasn't run it yet against
the live data to classify the rows (abandoned checkouts vs. missed
webhooks vs. test rows).

🟡 **IVS Real-Time is dormant.** Code is fully wired and audited (#229,
#233). Activation needs operator IAM + Railway env + a Vercel-preview
smoke pass per `docs/IVS_ACTIVATION.md`. Mux remains the active
provider — that path also untested live in this session.

🟡 **Observability gap.** Backend Sentry init present but DSN not set
→ errors aren't being collected. Frontend Sentry not installed at
all. The next outage would surface via merchant email or Twitter, not
a dashboard.

🟡 **No staging environment.** Production is the first place backend
changes actually run. The `Optional` outage this session was caught
in production logs, not pre-deploy. A second Railway service mirroring
prod is the structural fix.

🟢 **Schema is stable and additive.** All migrations this session are
additive (`ADD COLUMN IF NOT EXISTS`, new tables, partial indexes).
Rollback is just don't-call-the-new-columns. No destructive changes.

🟢 **No money paths modified this session.** Stripe Connect logic,
checkout endpoints, payment_intent handling, `application_fee` math
— untouched. The atomic-claim PR (#225) was on the webhook
*idempotency* side, not the side effects.

## Blockers vs. soft items

### Blockers (must do before broad merchant launch)
1. **Run one real live show end-to-end** — Topgun owner cuts a stream,
   takes one real Stripe charge, ships product. Confirms the whole
   path actually works in the real world.
2. **Set `SENTRY_DSN_BACKEND` on Railway** — so the next outage shows
   up in Sentry instead of a merchant email.
3. **Install frontend Sentry** — `cd frontend && npx @sentry/wizard@latest -i nextjs`,
   set the four DSN/auth env vars on Vercel.
4. **Set up uptime monitor** per `docs/UPTIME.md` — `/api/health` every
   1 min, alert after 2 consecutive failures.
5. **Run the `/api/health/orders-audit` against Topgun's owner_id** —
   classify the 13 stuck rows. Use the existing `/recover-pending`
   button if any have `stripe_payment_intent_id` set.

### Soft items (do before scaling to 100 merchants)
6. Lighthouse run on the homepage — confirm LCP < 2.5s mobile.
7. Verify the 3 redirects (`/contact`, `/for-business`, `/become-a-merchant`).
8. Stripe webhook CLI replay test (validates #225's atomic claim).
9. Real-device mobile QA: iOS Safari + Android Chrome, focus
   `/dashboard`, `/dashboard/post`, `/project/[id]`.
10. Apply migration `047_replay_url.sql` (additive; safe).
11. IVS activation per `docs/IVS_ACTIVATION.md` (when ready to
    replace Mux).

### Not blockers (deliberate parking)
- Clover integration — needs sandbox app registration first.
- Mux removal — wait until IVS is proven in prod for 2 weeks.
- Server-side homepage conversion (LCP win) — 3,100-line refactor,
  not justified yet.
- Staging environment — bigger infra change; document and plan.

## Recommended first-merchant onboarding sequence

For Topgun specifically (the founding merchant), in order:

1. **Confirm Stripe Connect status is verified** on `/merchant` →
   "Setup & Stats" tab. If not, complete onboarding.
2. **Audit existing orders** — call `/api/health/orders-audit` with
   Topgun's owner_id (admin token). Review the breakdown; click
   "Recover Orders" only for the subset with `stripe_payment_intent_id`
   set.
3. **Post one item** via `/dashboard/post` — photo + price + title.
   Confirm it appears on the storefront.
4. **Cut a real live show** — even 5 minutes, with one friendly viewer
   on a second device. Watch for:
   - "Starting your live show…" panel appears immediately on click
   - Camera prompt fires once
   - LIVE state propagates to the viewer within ~15s (#233)
   - One Stripe test purchase from a card you control
   - Webhook fires, order flips to `paid` within seconds
5. **End the stream** — confirm DB row clears (`is_live → false`),
   AWS stage deletes (verify in console if IVS is on).
6. **If anything broke**: file the symptom precisely (URL, exact
   click sequence, what was expected, what happened) — that's the
   next PR.

## Recommended next milestone

**"One real live sale, end-to-end."** Not 100 merchants. Not 1,000.
One.

After that lands cleanly, the next milestone is **"Three merchants,
one stream each, two real buyers per stream."** Volume earned by
proof, not by faith.

## Closing

The platform is in good shape technically. The doctrine (flat fee, 0%
commission, Stripe-first, live-first) is intact across every PR. The
code paths for the headline flows exist and have been individually
audited.

What's missing is the *receipt* — the first real customer hitting buy,
the first real merchant being paid, the first real bug report from a
real shop owner. That's not something I can ship as a PR.

Honest launch confidence: **C → B once one real sale is recorded**.
Don't ship to 100 merchants until that first sale exists.

---

*See `docs/operator-launch-runbook.md` for the exact step-by-step
operator actions referenced above.*
