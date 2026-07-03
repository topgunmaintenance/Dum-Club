# Handoff Implementation — Status Report
# Source: `Dum.club site access.zip` (design_handoff_go_live_homepage)
# Date: 2026-07-01 · Supersedes the plan version written earlier today

## TL;DR

The June 2026 homepage/go-live handoff has **already been implemented
on GitHub main** (deployed via Vercel/Railway) by parallel Claude
sessions, most recently PRs #472–#487 (the last landing today,
2026-07-01). The plan originally written in this file was drafted
against a local checkout that was **779 commits behind main** — it is
obsolete. This file now records what shipped, where the implementation
deliberately diverged from the zip, and what was done locally today.

## What main already has (verified against origin/main @ 477a365)

- **Design tokens:** light theme adopted site-wide via the "June 2026
  handoff palette" (`--surface-page #F7F9FA`, `--brand-teal #14B89A`,
  `--surface-inverse #0C1B2A`) — commit `ee925ed` "adopt handoff
  design tokens + repoint UI primitives", plus restyles of nav/footer/
  tab bar, Discover + live-now rail, live flow, storefront, dashboard,
  Clubs, Orders (`0634b98`…`df4a258`).
- **Homepage:** root `/` is now the buyer Club home (ClubHome — the
  Discover experience: category pills, Live now, Starting soon,
  businesses grid). The merchant marketing page (the zip's subject)
  lives at **`/welcome`**, linked from For Business / Pricing nav.
- **Go-live demo + category filter:** `c810437` "real live-tile
  category filter + interactive go-live demo".
- **Live selling (beyond the zip's scope):** Whatnot-style 3-column
  seller studio, desktop viewer layout, owner live view (`50808bc`,
  `8e565c7`, `8bc59e8`) on the existing IVS components.
- **No fake data:** zero picsum/loremflickr references in the repo.
  The hardcoded 10-tile fake grid from the zip was **explicitly
  rejected**; instead `bb2e463` added a single clearly-labeled
  LiveNowDemoTile for the empty state, with a matching doctrine
  exception written into CLAUDE.md (one tile max, "DEMO" label, no
  LIVE badge, auto-removes when a real business goes live).

## Where main deliberately diverges from the zip

| Zip handoff | Shipped on main |
|---|---|
| Accent `#1C8A5B` forest green | Brand teal `#14B89A` |
| Page bg `#FAF8F5` warm off-white | `#F7F9FA` cool off-white |
| Space Grotesk + Work Sans | Geist (+ Caveat accents) — no new fonts |
| Marketing homepage at `/` | Buyer Club home at `/`; marketing at `/welcome` |
| 10 hardcoded example live tiles | Real data + single labeled demo tile |
| — | Doctrine updated: **$39–$2,000+/mo + 1.5% sales fee** (CLAUDE.md on main; replaces the old $29/0% model this file previously assumed) |

Treat main as authoritative: it is what's deployed and what the
current CLAUDE.md doctrine describes.

## What was done locally today (this Mac)

1. Removed a stale `.git/index.lock` (crashed git process, May 10).
2. Parked the old uncommitted WIP (brand-teal primitives, Navbar/
   pricing edits — pre-handoff track, superseded) as commit `356096c`
   on its original branch `claude/setup-local-ai-agent-7GUvR`.
3. Fast-forwarded local `main` 781 commits to `477a365`.
4. Fresh-installed deps and ran a full production build of latest main.

## 🔴 Finding: latent build break on main — fixed, needs push

A fresh `npm install` + `npm run build` of main **fails**:
`app/welcome/page.tsx:96` imports the `RealtimeChannel` type from
`@supabase/supabase-js`, which v2.99.x (per package-lock) does not
re-export (TS2459). **Vercel deploys stayed green only because its
restored build cache masks the error** — any cache-invalidated deploy
or clean local checkout is broken.

Fixed on branch **`fix/welcome-realtime-type-import`** (commit
`f3b6e60`): one-line type-only import swap to `@supabase/realtime-js`.
Verified: full production build compiles clean, all 48 routes,
matching Vercel's route manifest. **Push from the Mac** (sandbox has
no GitHub write credentials):

    git push -u origin fix/welcome-realtime-type-import

then open/merge the PR.

## Housekeeping notes

- `next@14.2.3` has a published security advisory (Dec 2025 — see
  nextjs.org/blog/security-update-2025-12-11). Plan an upgrade to a
  patched 14.2.x. Separate task; touches nothing else.
- This Mac's `frontend/node_modules` is in a partial state from
  interrupted installs — run `npm install` in `frontend/` before
  local dev.

## ⚠️ Finding: `/welcome` carries doctrine-violating legacy content

`frontend/app/welcome/page.tsx` (3,330 lines) is a mixed page. Today's
PRs (#485–#487) built handoff pieces INTO it (GoLiveDemoPhone,
LiveNowDemoTile, real live-tile category filter) — but it still
contains pre-handoff v1 content that violates doctrine Rule #2
("never fake data") and the Phase 0A strip:

- `CREATOR_STORIES` — fictional named people with fabricated revenue
  claims ("Mike T. made $420 in week one", "Sarah K., 22 sign-ups").
  Fake testimonials are a real liability for a company with a live
  `/investors` page.
- `ACTIVITY_MESSAGES` — a simulated platform-activity ticker
  ("Offer purchased via Stripe checkout", "Returning customer used
  DUM Points") on a 3-second loop. Simulated tickers are explicitly
  banned; DUM Points shouldn't surface pre-Phase-2.
- v1 AI-builder flow ("Reading your idea… Building your storefront…").

Mitigating factors: the page is **orphaned** (no nav/component links
to it — nav "For Business" → `/business`; root `/` is ClubHome), so
it's only reachable by direct URL, and a parallel Claude session was
actively committing to this exact file today (last merge 19:33 UTC).

**Recommendation:** once the active session settles, run a surgical
task to strip `CREATOR_STORIES`, `ACTIVITY_MESSAGES`, and the
AI-builder flow from `/welcome` (keeping the handoff demo sections),
or fold the good sections into `/business` and retire `/welcome`
behind a 308 redirect. Deleting it wholesale was attempted and
reverted today — it would have destroyed same-day handoff work.

## Other remaining ideas from the zip (not urgent)

- The zip flags demo auto-play should default OFF for real visitors —
  verify the shipped GoLiveDemoPhone behavior on `/welcome`.
- Local queue items 7–12 in `.claude/tasks/queue.md` (visual overhaul
  v2, brand-teal/PR-A–F) predate the handoff implementation — audit
  against main before running any of them; most are likely shipped or
  superseded.
