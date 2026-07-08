# ROADMAP — DUM Club v5.0
# Living status doc. Updated on ship, not continuously.
# Doctrine lives in CLAUDE.md; this file is the execution view.
# Rewritten 2026-07-08 from a full code + database audit — this file
# now describes the system AS BUILT, not as aspired. If a claim here
# drifts from the code, re-audit and fix this file (CLAUDE.md is
# doctrine; this file is reality).

---

## Right now

| | |
|---|---|
| **Phase** | 1 (Phase 0A + 0B done) |
| **Complete** | ~2% of the Phase 1 goal (2–3 of 100 founding sellers connected) |
| **Blocked on** | Recruitment (human) + flipping live-selling out of dormant mode |
| **Next unlock** | Phase 1 → Phase 2 (needs 10+ verified sellers AND $1,000+ real GMV AND points-purchase legal review) |

### Production snapshot (queried 2026-07-08)

- **Merchants:** 6 total, 3 with Stripe connected. Only ~2 are real founding sellers: Topgun Maintenance (slot 1, `verified`) and Dark Cloud (slot 7, `verified`, onboarded today via the fixed Connect flow). Slot 2 is a duplicate Topgun (inactive).
- **Projects/storefronts:** 63 total, 44 public, but only **4 verified** and **2 have ever gone live**.
- **Offers:** 62 · **Paid orders:** 4 · **Live GMV:** $13.00 · **Plan tiers seeded:** 5.
- ⚠️ **Data hygiene:** 44 public projects vs 4 verified means many test/placeholder storefronts are publicly visible. Clean this before serious Phase 1 recruiting (see External blockers).

---

## As-built system inventory
*Ground truth from a full frontend + backend + schema audit on 2026-07-08. This section exists so any agent (or session) can orient without re-reading the whole repo. Cite it, but re-verify before you rely on it for a code change.*

### Buyer surfaces (all real, real-data-driven)
- `/` — Club discovery home (`components/discover/ClubHome.tsx`): search, category pills, Live Now rail (self-hides when nothing live), `DemoStoreRail` bridge (homepage-only, EXAMPLE tiles, self-hides when a real shop goes live), interactive go-live demo, businesses grid, seller pitch below.
- `/discover` — same feed, feed-only. Hosts the real-sales-only `LiveActivityTicker`.
- `/project/[id]` — storefront + live room (largest file, ~9.5k lines): offers, Stripe checkout, reviews, replay card, pop-in bubble, owner-inline studio, latent auction + token subsystems (gated).
- `/clubs` — a signed-in viewer's followed shops. `/orders` — buyer order history. `/hub` — DUM Points hub (direct URL only, not in nav). `/technology` — the only consumer page naming Solana (footer link).
- Embeds: `/embed/[businessId]` (full overlay on merchant's own site), `/embed/bubble/[businessId]` (live bubble), `/ai/embed/[slug]` (AI sales chat).

### Merchant surfaces (all real, wired)
- `/merchant` — signup + 30-day card-upfront trial (redirects to Stripe Checkout when backend returns `checkout_url`), then a 5-step launch checklist.
- `/dashboard` (+ `/dashboard/post` composer, `/dashboard/ai-agent` config) — command center; metrics read real analytics with `|| 0` fallbacks (no fake numbers).
- `/business`, `/why-dum-club`, `/pricing`, `/upgrade`, `/demo`, `/qr`, `/install`, `/project/[id]/manage`.
- Admin: `/admin/{merchants,operations,outreach,proofs,system}` (gated).

### Live selling
- Built end to end: `IVSStageHost.tsx` (WebRTC broadcast), `IVSStageViewer.tsx`, `LiveChatIVS.tsx`, "Go Live" entry points (navbar CTA, `FloatingGoLive`, `/dashboard/post`).
- **Dormant in production** — host/viewer render gated behind `NEXT_PUBLIC_ENABLE_IVS_REALTIME` (frontend) and `ENABLE_IVS_REALTIME_BACKEND` (backend), both default **false**. Recording gated behind `ENABLE_IVS_RECORDING`.
- Auctions: full subsystem, wired (live bid WebSocket, anti-snipe). Replay/showcase: `ReplayCard` renders recorded video with REPLAY/VIDEO labels (never LIVE). No dedicated flash-sale countdown component (only auction + trial countdowns).

### Backend feature matrix
| Feature | State |
|---|---|
| Stripe Connect (Express OAuth, callback, status) | **Implemented** — fixed 2026-07-08 (PR #586); proven live (Dark Cloud) |
| Stripe Checkout + platform `application_fee` (sales fee) | **Implemented** — direct charge into merchant account |
| Subscription trial + billing (30-day card-upfront, billing portal) | **Implemented** |
| Founding cap + slot + `/founding-status` | **Implemented** — public response returns ONLY `{founding_program_open}` (doctrine-compliant) |
| AWS IVS live streaming | **Built but DORMANT** (env flag off) |
| Auctions | **Implemented** |
| Replay recording + viewer-hour metering | **Built but env-gated**; overage invoicing is **manual only** (no cron) |
| AI retention / win-back texts (doctrine: Growth+) | **ABSENT** — marketing only, no code |
| AI social media posting (doctrine: Pro) | **ABSENT** — marketing only, no code |
| DUM Points (earn/spend/purchase/Solana claim) | **Implemented**; purchase + claim endpoints are **ungated at the API** (hidden only in the nav) |
| Outreach email templates + admin outreach | **Implemented** (admin-gated) |
| Whatnot seller scraper | **ABSENT** |
| LLM for AI chat | Local **Ollama** on the Railway host |

### Feature flags currently OFF in production
`ENABLE_IVS_REALTIME_BACKEND` / `NEXT_PUBLIC_ENABLE_IVS_REALTIME` (live selling), `ENABLE_IVS_RECORDING` (replay capture), `NEXT_PUBLIC_ENABLE_SOL_CHECKOUT` (pay-with-Solana button), `ENABLE_AI_FEATURES` (AI surfaces). Live selling for Phase 1 depends on flipping the IVS flags.

---

## Doctrine vs reality — reconcile these
*Audited 2026-07-08. Most items were fixed the same day and verified in a cloud
build (py_compile + human-copy guard passed). Remaining items are backlogged.*

**Resolved 2026-07-08:**

1. ✅ **Sales fee.** The live DB was already at 1.5% on every tier (applied out of band ~2026-06-11; the 2026-06-16 order shows a $0.15 fee on $10.00). The audit's "1%" was a stale read of migration 082's file header, now corrected to "APPLIED." Doctrine and production agree. (§13 projections still say "1%" — self-flagged illustrative, low priority.)
2. ✅ **DUM Points pill hidden.** `DumPill` render removed from `SiteChrome.tsx` (component kept for Phase 2).
3. ✅ **Points/Solana endpoints gated server-side.** `dum_points.py` `/purchase`, `/claim`, `/swap`, `/swap-demo` and the `checkout.py` webhook fulfillment branch now fail closed behind `ENABLE_POINTS_PURCHASE` / `ENABLE_SOLANA_CLAIM` (default off).
5. ✅ **AI features honesty.** AI retention win-back (Growth+) and AI social posting (Pro) marked "coming soon" across pricing/upgrade/about/business/why-dum-club + compare table + calculator, and in CLAUDE.md §3/§4. Build still pending.
6. ✅ **Stripe Connect copy.** `/technology` now says "Express" (was "Standard").
8. ✅ **Access-control gap.** `/dashboard/review` now wrapped in `AdminRoute`.

**Still open (backlogged):**

4. **30-day trial doctrine vs 60-day trial schema.** Legacy `043` scaffolding (60-day, no-card, largely unapplied) contradicts the 30-day card-upfront doctrine. Sweep when next touching trial code.
7. **Square residue.** `merchants` still has dormant `square_*` columns despite Stripe-only doctrine. Drop in a future migration.
9. **Legacy v1 token/AI-builder bleed-through (internal).** `/dashboard/review` still POSTs `starting_price`/`market_cap`; `generate_app.py`/`refine_project.py`/`launch.py` routes still mounted. Not consumer-visible; clean up later.

---

## Phase ladder

Status key: ✅ shipped · 🔄 in progress · ⏸️ blocked on external · 🔒 locked

---

### Phase 0A — Strip v1 AI-builder framing — Done ✅
Consumer pages no longer pitch "type an idea → AI builds a business" (signup is manual field entry; `ENABLE_AI_FEATURES=false`). Solana confined to `/technology` + backend reconciliation columns. Fake data clean (no `CREATOR_STORIES`/`ACTIVITY_MESSAGES`; `LiveActivityTicker` is real-sales-only; `DemoStoreRail` is the sanctioned homepage bridge). Main-street pivot copy adopted everywhere; no stale `$29`/`60 days free` copy remains.
**Caveat:** the `DumPill` beta surface partially undercuts "points hidden" (see reconciliation #2).

### Phase 0B — First real paid Stripe transaction — Done ✅ (2026-07-08)
4 live (`cs_live`) paid orders against Topgun since 2026-05-06 (all `source: live`), plus new-merchant Connect proven the same day (Dark Cloud onboarded to `verified` and reached live checkout; Connect 500 fixed in PR #586). Counted complete on Julian's call 2026-07-08. Note the paid orders are founder self-tests ($13 total); the first genuine external-customer sale is still a nice-to-have milestone, not a gate.

### Phase 1 — 100 founding sellers — Active 🔄 (~2%)
**Target (founder decision 2026-07-08):** recruit BOTH local main-street businesses AND live resellers.

**Already shipped (was Phase 1 scope, landed during 0B):** homepage/Club feed, IVS live-selling UI (dormant behind flags), auctions, replay, outreach email templates carrying the flat-fee + "1.5% (Whatnot 8%)" pitch. Founding-100 scarcity counter correctly retired (public endpoint returns a boolean only).

**Remaining work (queued in `.claude/tasks/queue.md`):**
- [ ] `merchant-data-cleanup` — dedupe the two Topgun rows, deactivate junk/test founding signups, purge/hide the ~40 unverified public storefronts, fix slot numbering. Julian approves exact rows; NO hard deletes.
- [ ] `enable-live-selling` — flip `ENABLE_IVS_REALTIME_BACKEND` + `NEXT_PUBLIC_ENABLE_IVS_REALTIME` and verify a real broadcast end to end (host → viewer → chat). Live selling is the core Phase 1 pitch and is currently dark.
- [ ] `outreach-main-street-pass` — refresh `backend/services/email.py` copy to the main-street pivot voice.
- [ ] `whatnot-lead-scraper` — `backend/agents/whatnot_scraper.py`, live-reseller leads → CSV.
- [ ] `local-business-lead-gen` — main-street business leads (Google Places) → separate CSV.
- [ ] Recruitment execution — Julian sends signup + storefront links to the lead lists (external).

**Done when:** 100 rows in `merchants` with a connected Stripe account (`stripe_connect_status IN ('connected','verified')`) AND `founding_slot_number BETWEEN 1 AND 100`. (Real connected merchants show `verified`, not `connected` — the gate counts both.)

### Phase 2 — DUM Points return, retention proven — Locked 🔒 (partly pre-built)
Substrate exists: `users.dum_balance`, append-only `dum_transactions`, cross-merchant attribution, and the `DumPill` beta UI. Missing: a points-purchase table/flow (legal-gated), wired cross-business spend ("coming soon"), and the two absent AI features (retention win-back, social posting) that doctrine ties to this era.
**Unlock:** 10+ verified sellers live AND $1,000+ real GMV AND legal review of the points-purchase flow. (Currently 4 verified, $13 GMV.)

### Phase 3 — Optional Solana layer — Locked 🔒 (columns-only)
Only reconciliation columns on `orders` (034) + `users.wallet_address`; a dormant `SolanaCheckoutButton` and per-project token subsystem exist behind flags/`SIM_` data (render to nobody). No consumer Solana surface today.
**Unlock:** Phase 2 proven with data AND legal sign-off on the Solana claim flow. Claim stays opt-in only.

### Phase 4 — Scale and monetize — Locked 🔒 (thin)
Tier + overage-billing scaffolding exists (`plan_limits`, `merchant_overage_invoices`, no-double-bill netting), but overage invoicing has no scheduler, and white-label / AI-social / enterprise are doctrine concepts with no dedicated schema yet.
**Unlock:** Phase 3 done AND the §13 revenue targets (themselves flagged stale/illustrative).

---

## External blockers
*Not Claude-solvable — need a human decision or action.*

| Status | Blocker | Owner | Blocks |
|---|---|---|---|
| ⏸️ | **Recruit 100 founding sellers** — send signup + storefront links to lead lists (both channels) | Julian | Phase 1 → Phase 2 |
| ⏸️ | **Decide: apply migration 082 (charge 1.5%) or keep 1% + update doctrine** | Julian | reconciliation #1 |
| ⏸️ | **Decide DumPill fate** (hide until Phase 2, or bless the beta) | Julian | reconciliation #2 |
| ⏸️ | Clear the stale `.git/index.lock` on the Mac + fast-forward local `main` (agent sandbox can't `rm`) | Julian | clean local git |
| 🔒 | Legal review of DUM Points purchase flow | Legal | Phase 2 |
| 🔒 | Legal sign-off on Solana claim flow | Legal | Phase 3 |

---

## Recently shipped
Newest first. Regenerate via `git log main --oneline -15`.

```
affbe5d  #586 fix(stripe): Connect OAuth + status checks 500ed on every request (Phase 0B unblock)
5841e7c  #584 fix(project): owners no longer see the public view flash before their console
a27d121  #583 fix(perf): stop WalletConnect registry prefetch on every page load
4b13d1f  #582 fix(copy): /upgrade tier grid joins the main-street pivot
71cc2a1  #581 feat(pages): consolidate /pricing + /business — numbers page and story page
253d2e4  #579 feat(copy): main-street pivot — every business gets 30 days free
9a2db26  #578 feat(dashboard): page views and unique visitors side by side
a8eaff8  #577 fix(admin): stats count only real revenue
3d9140a  #576 feat(admin): merchant toolkit — delete, cancel sub, checkout link, stats
b5c9cbc  #575 feat(billing): 30-day card-upfront trial via Stripe Checkout
```

---

## How this file relates to the others

| File | Horizon | Purpose |
|---|---|---|
| `ROADMAP.md` (this) | months | Phase ladder, as-built inventory, doctrine-vs-reality, blockers |
| `CURRENT_SPRINT.md` | week | Active sprint tasks inside the current phase |
| `NEXT_TASK.md` | hours | Atomic next action to take right now |
| `BACKLOG.md` | undated | Unprioritized ideas |
| `CLAUDE.md` | permanent | Doctrine, positioning, absolute rules |

Rule of thumb: if `ROADMAP.md` and `CLAUDE.md` disagree on gates/goals, CLAUDE.md is doctrine and this file is stale — fix this file. If this file's *as-built inventory* disagrees with the code, the code wins — re-audit and fix this file.
