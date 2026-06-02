# ROADMAP — DUM Club v5.0
# Living status doc. Updated on ship, not continuously.
# Doctrine lives in CLAUDE.md; this file is the execution view.

---

## Right now

| | |
|---|---|
| **Phase** | 0B |
| **Complete** | ~90% |
| **Blocked on** | 1 real paid Stripe transaction (external — Julian's outreach) |
| **Next unlock** | Phase 0B → Phase 1 (100 founding seller recruitment sprint) |

### Active diagnostics
- _None._ The "Untitled Project" fallback on `/project/topgun-maintenance` is resolved in production; `loadProject()` is reaching Railway and the seeded row is hydrating. Visual QA spec `frontend/tests/visual/project-page.spec.ts` now hard-fails if the placeholder reappears.

### Production-ready subsystems
- **Email + reminder loop** (verified 2026-06-01). `dum.club` Resend domain verified, `RESEND_API_KEY` + `EMAIL_FROM` set on Railway. Four Railway cron services live: `live_reminders` (every 5 min), `schedule_rollforward` (hourly), `trial_reminders` (daily 13:00 UTC), `merchant_recap` (Mondays 13:00 UTC) — all referencing the backend service's variables, all running commit `52903f6` or later. End-to-end smoke confirmed: seed → cron pick-up → Resend POST 200 → Gmail delivery.

### Known issues — non-blocking
- _None known._ The previously listed `_resolve_owner_uuid` AttributeError and `apiBase.ts` localhost-in-prod silent fallback have both been resolved: the upsert chain no longer calls `.select()` (postgrest-py 0.16 dropped that method on the upsert builder), and `apiBase.ts` now throws at module load when `NEXT_PUBLIC_API_URL` is missing in a production build.

---

## Phase ladder

Status key: ✅ shipped · 🔄 in progress · ⏸️ blocked on external · ⚠️ broken/diagnosing · 🔒 locked

---

### Phase 0A — Done ✅

**Goal:** Strip v1 AI-builder framing. Hide DUM Points / Solana from consumer pages. Reposition homepage.

**Unlock conditions:** none — starting point.

**Tasks:**
- ✅ Demo storefronts hidden from Discover
- ✅ Ticker shows real data only
- ✅ Solana language moved to `/technology` page only
- ✅ DUM Points hidden from navbar
- ✅ `/hub` cleaned up — no Solana language in default view
- ✅ Buy Points panel hidden
- ✅ Fictional moat section removed (Mario's Cafe)
- ✅ Homepage repositioned to local services

**Done when:** Consumer-facing pages contain no v1 AI-builder language and no consumer-facing Solana surface. **Shipped.**

---

### Phase 0B — Active 🔄

**Goal:** One real paid Stripe transaction through the Topgun Maintenance storefront.

**Unlock conditions:**
- ✅ Phase 0A done

**Core tasks (from CLAUDE.md §6):**
- ✅ Remove DUM Points from navbar (mobile + desktop) — `b2e70ab`
- ✅ Bump `FOUNDING_CAP` to 100 everywhere — `b2e70ab`
- ✅ Build Topgun Maintenance LLC storefront (migration 031) — `fab6ade`
- ✅ Storefront routable at `/project/topgun-maintenance` (slug lookup backend) — `fab6ade`
- ⚠️ Storefront rendering correctly with seeded data — **active diagnostic, see blockers**
- ✅ Discover shows verified founding merchants (backend verified-OR fallback) — `a5ef9ec`
- ✅ Homepage comparison: Whatnot / Commonsold / Google Maps — `9336946`
- ⏸️ **Get 1 real paid Stripe transaction** — Julian's task, external outreach

**Beyond original 0B scope — shipped in this window:**
- ✅ `/business` landing page rebuilt (full seller recruitment) — `06d956e`
- ✅ Square removed from merchant page (Stripe-only per Rule 11) — `a14304b`
- ✅ Homepage hero redesigned (seller focus, no v1 textarea) — `f62c114`
- ✅ Fee savings calculator on homepage — `3def3f1`
- ✅ Universal search: 3-section results (Live / Business / Items for Sale) — `31f7255`
- ✅ `/api/offers/search` endpoint (Items section queries real `offers` table) — `57d2b02`
- ✅ Homepage service-finder search bar + 8 quick pills — `f9d0987` / `1120634`
- ✅ Brightness pass (design contrast lift) — `98db0e1`
- ✅ Shared category taxonomy in `lib/categories.ts` (Vercel build unblock) — `d1fc390`
- ✅ FounderNote: Julian headshot + flat-fee copy — `a1a1509`
- ✅ `loadOffers` / `loadMemories` use project UUID not URL param (slug safe) — `2674dcc`

**Done when:** One Stripe checkout in production mode completes against Topgun's storefront. A single `orders` row with `status='paid'` and `amount > 0` unlocks Phase 1.

---

### Phase 1 — Locked 🔒

**Goal:** 100 founding sellers recruited.

**Unlock conditions:**
- 🔒 Phase 0B done (one real Stripe transaction)

**Tasks:**
- 🔒 Whatnot seller scraping agent (`backend/agents/whatnot_scraper.py`)
- 🔒 Update 4 outreach email templates — Whatnot flat-fee pitch
- 🔒 Homepage redesign — Whatnot visual energy:
  - Live Now grid (AWS IVS)
  - Best Deals This Week section
  - Founding 100 banner with real slot counter
  - Category browse row
  - Google reviews display per business
- 🔒 Activate AWS IVS live selling for merchants
- 🔒 "Go Live" button on merchant dashboard

**Done when:** 100 rows in `merchants` table with `stripe_connect_status='connected'` AND `founding_slot_number BETWEEN 1 AND 100`.

---

### Phase 2 — Locked 🔒

**Goal:** DUM Points return, retention proven.

**Unlock conditions:**
- 🔒 10+ real verified sellers live on platform
- 🔒 At least $1,000 in real GMV processed through Stripe
- 🔒 Legal review of points purchase flow complete

**Tasks:**
- 🔒 Restore DUM Points to navbar
- 🔒 Cross-merchant loyalty active (earn at detailer, spend at pizza shop)
- 🔒 AI retention agent automating point reminders
- 🔒 Customer retention program replaces direct mail pitch
- 🔒 Points dashboard for sellers showing retention data

**Done when:** DUM Points visible in navbar AND customer return-rate via points is measurable per-seller via dashboard.

---

### Phase 3 — Locked 🔒

**Goal:** Optional Solana layer.

**Unlock conditions:**
- 🔒 Phase 2 proven (points driving repeat purchases — data required)
- 🔒 Legal sign-off on Solana claim flow

**Tasks:**
- 🔒 Optional Solana claim behind "Advanced" toggle
- 🔒 Never mandatory, never on consumer-facing pages

**Done when:** Solana claim ships as an opt-in toggle only. No consumer-facing Solana surface area anywhere except `/technology`.

---

### Phase 4 — Locked 🔒

**Goal:** Scale and monetize.

**Unlock conditions:**
- 🔒 Phase 3 done

**Tasks:**
- 🔒 Flat fee tiers fully active for all new sellers (founding period closed)
- 🔒 B2B white-label points product launched
- 🔒 AI social media service productized
- 🔒 City-by-city replication begins
- 🔒 Enterprise loyalty contracts

**Done when:** Year-1 revenue projection from CLAUDE.md §13 hit (~$70k/month total stream).

---

## External blockers

Things that aren't Claude-solvable and need a human decision or action.

| Status | Blocker | Owner | Blocks |
|---|---|---|---|
| ✅ | ~~Run `bash scripts/fetch-topgun-photos.sh` to mirror Topgun photos locally~~ — superseded by migration 033, which points image URLs at the public originals on topgunmaintenance.com. The mirror script stays as a contingency. | — | _resolved_ |
| ✅ | ~~Rebind Topgun `business_profiles.owner_privy_id` from `seed:topgun-maintenance` to Julian's real Privy DID~~ — now automatic via `backend/services/seed_claim.py`. First sign-in with `julian@topgunmaintenance.com` triggers the rebind on both `business_profiles` and `projects`. Audit row written to `seed_claim_audit`. | — | _resolved_ |
| ⏸️ | **Send `/project/topgun-maintenance` link to 20 real contacts** | Julian | Phase 0B → Phase 1 |
| 🔒 | Legal review of DUM Points purchase flow | Legal | Phase 2 |
| 🔒 | Legal sign-off on Solana claim flow | Legal | Phase 3 |
| 🔒 | 10+ verified sellers live | Outreach | Phase 2 |
| 🔒 | $1,000+ real GMV through Stripe | Organic | Phase 2 |

---

## Recently shipped

Last 15 commits on `main`, newest first. Regenerate via `git log main --oneline -15`.

```
c3c700e  feat(retention): recurring weekly auto-roll for scheduled_live_at (#292)
f07274a  feat(admin): operations overview dashboard for live ops visibility (#291)
73b3fd0  fix(live): tap-to-retry recovery on the customer-side ended state (#290)
428ab81  feat(retention): replay-share affordance + OG enrichment (#289)
6a566e5  feat(retention): customer "remind me when live" loop, complete (#288)
3a15644  feat(retention): scheduled_live_at — weekly merchant retention keystone (#287)
116df9d  fix(mobile): safe-area-inset-bottom on two unhandled sticky bottom bars (#286)
56b3194  fix(embed): cache last-known bubble live state in sessionStorage (#285)
52e4183  fix(storefront): sticky pinned-offer strip during mobile livestream (#284)
b18b843  fix(storefront): instant top-of-viewport toast on ?checkout=success (#283)
b75440f  fix(embed): clearer "Watch live →" affordance on the live bubble (#282)
b945706  fix(live): hide FloatingGoLive when Stripe is not verified (#281)
3afa8ea  fix(dashboard): "Preview as customer" link on each project card (#280)
9a95d9e  fix(onboarding): add "Pin a featured item" row to GetLiveSteps (#279)
343fec0  fix(merchant): set Stripe expectations before the Connect Stripe click (#278)
```

### In flight on `claude/adoring-fermat-uEfs0` (pending merge)

```
fix(onboarding): drop .select() chain on profile upsert (supabase-py 2.5.1)
fix(admin): correct Stripe fees column names on operations overview
feat(retention): weekly merchant recap email (cron + log)
feat(acquisition): /why-dum-club comparison surface for outreach
docs(smoke): pre-outreach operator checklist (browser end-to-end)
docs(email): RESEND_API_KEY pipeline audit + safe test recipe
docs(cron): production setup for live_reminders + schedule_rollforward
```

These ship together as the pre-outreach readiness bundle: three
operator docs (cron / email / smoke), one merchant-acquisition
surface, one retention cron, and two production bug fixes
surfaced while writing the docs.

### Older shipped (kept for diff context)

```
98db0e1  style: brightness pass — lift the dark theme, add emerald glow
d1fc390  fix(build): move category taxonomy out of app/page.tsx — unblock Vercel
1120634  fix: kill homepage void + universal quick-search pills
57d2b02  feat: /api/offers/search endpoint + wire Items for Sale to real offers
31f7255  feat: universal search — 3-section results, filter bar, category grid
f9d0987  feat: homepage service-finder search bar + quick pills
3def3f1  feat: FeeCalculator component — interactive savings slider
f62c114  feat: homepage hero redesign — seller recruitment focus (v5.0)
06d956e  feat: rebuild /business as seller recruitment landing page
a14304b  fix: remove Square connect from merchant page — Stripe only per v5.0
9336946  fix: comparison table — Whatnot/Commonsold/Google Maps per CLAUDE.md v5.0
a5ef9ec  fix(discover): surface verified founding merchants regardless of status
8f334f1  fix: tighten hero spacing + reduced-motion fallback for entrance anims
a1a1509  fix: FounderNote — Julian headshot, Topgun LLC copy, flat-fee pitch
2674dcc  fix: loadOffers + loadMemories use project UUID, not URL param (slug safe)
```

---

## How this file relates to the others

| File | Horizon | Purpose |
|---|---|---|
| `ROADMAP.md` (this) | months | Phase ladder, unlock conditions, external blockers, changelog |
| `CURRENT_SPRINT.md` | week | Active sprint tasks inside the current phase |
| `NEXT_TASK.md` | hours | Atomic next action to take right now |
| `BACKLOG.md` | undated | Ideas that haven't been prioritized yet |
| `CLAUDE.md` | permanent | Doctrine, positioning, absolute rules |

Rule of thumb: if `ROADMAP.md` and `CLAUDE.md §6` disagree, `CLAUDE.md` is doctrine and this file is stale — fix `ROADMAP.md`. If `ROADMAP.md` and `CURRENT_SPRINT.md` disagree, the sprint is tactical truth for this week and the roadmap is the strategic frame around it.
