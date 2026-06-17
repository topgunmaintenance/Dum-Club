# ROADMAP — DUM Club v5.0
# Living status doc. Updated on ship, not continuously.
# Doctrine lives in CLAUDE.md; this file is the execution view.

---

## Right now

| | |
|---|---|
| **Phase** | 1 |
| **Complete** | 0% (just unlocked) |
| **Blocked on** | Nothing internal. Phase 1 is founding-seller recruitment — external outreach |
| **Next unlock** | Phase 1 → Phase 2 (10+ verified sellers · $1,000+ real GMV · points legal review) |

### Active diagnostics
- _None._ The "Untitled Project" fallback on `/project/topgun-maintenance` is resolved in production; `loadProject()` is reaching Railway and the seeded row is hydrating. Visual QA spec `frontend/tests/visual/project-page.spec.ts` now hard-fails if the placeholder reappears.

### Known issues — non-blocking
- _None known._ The previously listed `_resolve_owner_uuid` AttributeError and `apiBase.ts` localhost-in-prod silent fallback have both been resolved: the upsert chain no longer calls `.select()` (postgrest-py 0.16 dropped that method on the upsert builder), and `apiBase.ts` now throws at module load when `NEXT_PUBLIC_API_URL` is missing in a production build.

---

## Phase ladder

Status key: ✅ shipped · 🔄 in progress · ⬜ not started · ⏸️ blocked on external · ⚠️ broken/diagnosing · 🔒 locked

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

### Phase 0B — Done ✅

**Goal:** One real paid Stripe transaction through the Topgun Maintenance storefront.

**Unlock conditions:**
- ✅ Phase 0A done

**Core tasks (from CLAUDE.md §6):**
- ✅ Remove DUM Points from navbar (mobile + desktop) — `b2e70ab`
- ✅ Bump `FOUNDING_CAP` to 100 everywhere — `b2e70ab`
- ✅ Build Topgun Maintenance LLC storefront (migration 031) — `fab6ade`
- ✅ Storefront routable at `/project/topgun-maintenance` (slug lookup backend) — `fab6ade`
- ✅ Storefront rendering correctly with seeded data
- ✅ Discover shows verified founding merchants (backend verified-OR fallback) — `a5ef9ec`
- ✅ Homepage comparison: Whatnot / Commonsold / Google Maps — `9336946`
- ✅ **1 real paid Stripe transaction** — live-mode (`cs_live_`) order against Topgun, $10.00 `status='paid'`, 2026-06-16 (`pi_3Tj6WA…`, 1.5% fee applied correctly). First live paid order was actually 2026-05-06; the gate has been met since early May.

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

**Done when:** One Stripe checkout in production mode completes against Topgun's storefront. A single `orders` row with `status='paid'` and `amount > 0` unlocks Phase 1. **Shipped — confirmed in the DB 2026-06-17.**

> Note: the four live paid orders to date all carry Julian's own
> buyer email — they prove the production checkout + 1.5% fee
> pipeline works end to end, but not yet external demand. Phase 1
> recruitment is what turns the proven pipeline into real buyers.

---

### Phase 1 — Active 🔄

**Goal:** 100 founding sellers recruited.

**Unlock conditions:**
- ✅ Phase 0B done (live Stripe transaction confirmed 2026-06-17)

**Tasks:**
- ⬜ Whatnot seller scraping agent (`backend/agents/whatnot_scraper.py`)
- ⬜ Update 4 outreach email templates — Whatnot flat-fee pitch
- ⬜ Homepage redesign — Whatnot visual energy:
  - Live Now grid (AWS IVS)
  - Best Deals This Week section
  - Founding 100 banner with real slot counter
  - Category browse row
  - Google reviews display per business
- ⬜ Activate AWS IVS live selling for merchants
- ⬜ "Go Live" button on merchant dashboard

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
| ✅ | ~~**Send `/project/topgun-maintenance` link to 20 real contacts**~~ — Phase 0B gate met; a live paid Stripe order landed against Topgun (2026-06-16). | Julian | _resolved_ |
| ⏸️ | **Recruit founding sellers** — outreach to Whatnot sellers toward FOUNDING_CAP = 100 | Julian | Phase 1 → Phase 2 |
| 🔒 | Legal review of DUM Points purchase flow | Legal | Phase 2 |
| 🔒 | Legal sign-off on Solana claim flow | Legal | Phase 3 |
| 🔒 | 10+ verified sellers live | Outreach | Phase 2 |
| 🔒 | $1,000+ real GMV through Stripe | Organic | Phase 2 |

---

## Recently shipped

Last 15 commits on `main`, newest first. Regenerate via `git log main --oneline -15`.

```
89887ac  feat: restyle LiveRail live cards Whatnot-style (count-ready pill) (#427)
69aa88f  chore: add agent guardrails — typecheck Stop hook + scope fence (#426)
f866308  fix(live): stack video→chat→offers + let customers sign in to chat (#425)
4e04807  fix(favorites): use canonical project UUID, not slug, on storefront (#424)
e4e5a2a  fix(checkout): restore synchronous Stripe verify and stop opaque 500s (#423)
83febc2  fix(checkout): retry the Buy POST on network failure instead of a dead 'Failed to fetch' (#422)
db2b1f7  fix(project): navbar Go Live deep-link works when already on the project page (#421)
fd533cc  fix(embed): tighten modal empty-state spacing when stream is offline (#420)
60ffba9  feat(embed): fit-to-viewport live window for the storefront modal (#420)
0345ea6  fix(embed): center seller in storefront modal camera (contain, no chin crop) (#419)
17a3c7c  fix(embed): proper-size live camera + restore chat in storefront modal (#419)
```

The window since the last roadmap refresh (~#293–#427) was a
live-selling + checkout hardening run: storefront embed/live-window
layout, customer chat sign-in, Stripe checkout retry + synchronous
verify, canonical-UUID fixes, and the agent guardrails (typecheck
Stop hook + scope fence) now enforced on every task.

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
