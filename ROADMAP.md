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
c1e1d0d  Merge #468: live room — host chat under camera, real share + likes, Discover preview
5a9abdd  feat(live): real preview frame on the Discover "Live now" card
dfe0955  feat(live): real shared likes over the chat socket
a045793  fix(live): mount the host chat directly under the owner's camera
ccdccff  feat(live): real share targets in the live room (Facebook / X / WhatsApp)
ce60dc4  Merge #467: storefront header cleanup + city/region location chip
318012a  feat(storefront): return city/region so the header location chip can render
57104dd  fix(storefront): clean buyer header + light "Powered by DUM Club" footer
ab99e7e  Merge #466: live-room overlay chat empty-state fix
4881551  fix(live): hide chat empty-state in the overlay room (overlapped the video)
52a2a75  Merge #465: live-first Club home — Live-now rail, offer-forward cards
0306c38  fix(points): mark DUM Points as beta — cross-business spend not live yet
fa4f576  fix(home): pills-clean — collapse filters, compact search, slim location
f18f22d  Merge #447: Follow / "Your Clubs" network layer (3a + 3b)
4f1c251  feat(live-reminders): ping followers on every go-live, not just the first
```

### Shipped this window — buyer "Club" experience + live room (PRs #461–#468)

The Discover/storefront surfaces were reworked into the Whatnot-style
"Club" buyer experience (Option B, on the local-business model), and the
live room got four real-feature fixes off Julian's screenshots:

- **Club home** — `/` and `/discover` now render the shared `ClubHome`
  (Live-now rail, offer-forward cards, pills-clean header). Marketing
  homepage preserved at `/welcome`. DUM Points marked beta.
- **Public storefront cleanup (#467)** — buyer-facing header (cover /
  avatar / category / location chip / Verified / Follow), removed the
  "From $X" placeholder, light "Powered by DUM Club" footer. Confirmed
  the Orders ledger + owner tools are owner-gated (no public leak).
  Added `business_profiles.city` / `region` (applied by hand) so the
  header location chip can render; Topgun set to Morristown, NJ.
- **Live room (#468)** — host chat now sits under the host's own camera;
  real share menu (Facebook / X / WhatsApp / Copy); real shared likes
  over the chat socket (per-show server total, not a local animation);
  and a real preview frame on the Discover "Live now" card (host uploads
  a ~320px snapshot every ~10s to `offers/live-thumbs/<id>.jpg`, no
  migration). The snapshot path touches `IVSStageHost` — verify on a
  real broadcast.

**Still open (separate backlog, not blocking 0B):** migration 079 (geo
columns for the "Near me" distance filter) is drafted, not applied;
per-feed live viewer counts wait on migration 077 (`live_viewer_count`).

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
