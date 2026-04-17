# Task: discover-rebuild

## Summary

Frontend-only rebuild of `/discover` as a buyer-facing local + live
commerce page. Decomposes the existing 1517-line monolith into ~16
files (logic / hooks / components). No backend changes, no new API
routes, no schema migrations. Ships behind `discover_v2_frontend`
feature flag.

This is **Pass 1 only**. Pass 2 (geo, follows, notifications,
PointsWallet, reviews, live viewer counts) is explicitly out of scope
and gated behind Phase 0B / Phase 2 doctrine conditions.

---

## Doctrine constraints

- CLAUDE.md §12 Rule 4 — No `<PointsWallet />` in navbar, no points
  balance, no drawer, no redemption UI anywhere on `/discover`.
- CLAUDE.md §6 Phase 0B — No features that assume paid transactions
  exist (no sold counts, no review display, no "X purchased" badges).
- CLAUDE.md §12 Rule 2 — No fake data. No synthesized ratings, sold
  counts, distances, or live viewer counts.
- Frontend only unless told otherwise — no new API routes.

---

## Positioning (Pass 1 copy, doctrine-safe)

**H1:** `Shop local. Meet the sellers behind it.`
**Sub:** `Live sellers and local businesses on one platform. Beta —
more sellers added weekly.`

The buyer promise in Pass 1: "real local sellers, real Stripe
checkout, live when they go live." Nothing more. No rewards claims,
no network effects, no redemption copy on this page.

---

## Information architecture (top to bottom)

1. **Header** (unchanged)
2. **Activity ticker** (keep; throttle to 1 item per 4s; clickable to
   seller; render client-only to avoid hydration mismatch)
3. **Compact hero** (max 260px desktop, 200px mobile; hidden for
   returning authenticated users)
4. **Trust strip** — 3 static items, no carousel:
   - `Stripe-secured checkout`
   - `Sellers paid direct via Stripe Connect`
   - `Founding merchants personally verified`
5. **Sticky filter bar** (sticks below header on scroll; wired to
   existing sort/price/live/deals + search input)
6. **Live Rail** — renders ONLY if any project has `is_live === true`;
   otherwise returns `null` (no empty shell, no placeholder)
7. **Listing grid** — `ListingCard` driven by existing project + market
   data; cards skeleton-load then upgrade as market data arrives
8. **Points footer** (muted, single line):
   `DUM Points are in beta — more ways to earn and redeem are coming.`
   If §12 Rule 4 forbids even this educational mention, delete it.
9. **Merchant recruitment strip** — single dark row linking to `/merchant`
10. **Footer** (unchanged)

---

## What gets removed from current page

- Giant all-caps "SHOP LOCAL. EARN EVERYWHERE." hero
- The broken "any"-only subheadline rendering bug
- "Top Businesses" points leaderboard block
- "Live businesses 30 / With offers 1 / Newest" stats row
- "Profile strength" bar on every card
- "Top 10 / Top 50 / Top 100 / Trending #N" ranking badges
- "View Project →" as a CTA label (becomes "Shop now" / "Watch live")
- Starfield canvas background (perf win)
- Section-nav sidebar (inline component, only used on /discover — do
  NOT delete `Starfield.tsx` since other pages import it)
- Any listing where `offers.length === 0` OR title starts with
  `Auto-created` / `No description` OR description length < 20

---

## Data contract (existing endpoints only)

**Primary:** `GET /api/projects/public`
Returns all public projects. No pagination. This is confirmed as the
endpoint the current page uses (line 449 of current page.tsx).

**Per-card market data:** `GET /api/projects/{id}/market`
Returns offers, price, market_cap, volume_24h per project.

**Offer search:** `GET /api/offers/search?q=<term>&limit=20`
Debounced 300ms, used for "Items for Sale" section.

**No new endpoints in Pass 1.** If `/api/projects/public` doesn't
return data needed, surface the gap — don't invent a route.

### Market-batch strategy (fixes N+1)

Current page fires `Promise.all` on ALL project IDs simultaneously.
Pass 1 batches in chunks of 8 via `Promise.allSettled`.

**Paint strategy: option (i) — wait for first batch.**
Cards do NOT render until the first batch of 8 `/market` calls
resolves. This adds ~200-400ms but avoids the jarring unmount problem
where zero-offer cards appear then vanish. If p50 exceeds 800ms,
switch to skeleton-then-upgrade with fade-out for filtered cards.

### Derived fields for ListingCard (from current data only)

```ts
type ListingCardVM = {
  id: string
  href: string                    // /project/:slug or /project/:id
  title: string                   // project.title || project.name
  category: string | null         // from classifyProject()
  description: string             // truncated at 120 chars
  thumbnail: string | null        // project.thumbnail || null
  ownerName: string               // project.owner.name
  ownerAvatar: string | null
  priceFromCents: number | null   // min(market.offers[].price_usd * 100)
  offersCount: number             // market.offers.length
  isLive: boolean                 // project.is_live === true
  hasPromo: boolean               // !!project.promo_copy
  hasSubscription: boolean        // derived from store_items
  createdAt: string
}
```

Fields not in the current API are NOT synthesized. No fake ratings,
no fake sold counts, no fake distances.

---

## Components to create

### `components/discover/DiscoverHero.tsx`
- Desktop max-height 260px; H1 40px; sub 16px
- CTA 1: `Browse sellers ↓` (anchors to `#grid`)
- CTA 2: `Become a merchant` (links `/merchant`)
- Hidden for authenticated returning users
- Fix: subheadline must render in full at all viewports (regression)

### `components/discover/TrustStrip.tsx`
- 3 static items, single row, no carousel
- Mobile: horizontal scroll allowed, no visible scrollbar
- No claims of buyer protection (no policy yet)
- No points copy here

### `components/discover/StickyFilterBar.tsx`
- `position: sticky; top: header-height; z-index: 40`
- Shadow on scroll
- Layout: `[Search] [Category ▼] [Sort ▼] [Price ▼] [Live now] [Deals only]`
- Category: dropdown on desktop, chips on mobile (kills broken scrollbar)
- "Live now" toggle: disabled with tooltip when no live results exist
- "Deals only" toggle: HIDDEN (not disabled) if `promo_copy` field is
  absent from all projects in the current result set
- "Nearest" sort option: hidden in Pass 1 (no geo data)
- Reset button appears when any filter is non-default

### `components/discover/LiveRail.tsx`
- Renders ONLY if `items.some(i => i.isLive)`
- Returns `null` if empty — no placeholder, no "going live soon"
- Static thumbnail + red `● LIVE` badge per card
- NO Mux autoplay on cards (perf/bandwidth; player stays on /project/:id)
- Horizontal scroll, snap alignment

### `components/discover/ListingCard.tsx`
Strict render rules using only current data:
- Top-left: category pill IF category is in allowlist (auto, home,
  beauty, restaurant, aviation, pet, health, entertainment); else none
- Top-right: `● LIVE` badge if isLive
- Thumbnail: deterministic gradient from id hash (no real thumbnails
  in current data); use `next/image` if thumbnails exist for Lighthouse
- Title: 1 line, ellipsized
- Description: 2 lines, ellipsized
- Price line: `From $X` if priceFromCents != null; `Watch live` if
  live and no price; hidden otherwise
- Badges: offer count, subscription, promo — same as current but
  without profile strength or ranking
- Primary button (full-width):
  - if isLive: `Watch live`
  - else if offersCount > 0: `Shop now`
  - else: card does not render at all
- **NEVER shows:** profile strength, Top N, Trending #, readiness
  score, ratings, sold counts, distances, DUM points earned

### `components/discover/ListingGrid.tsx`
- Grid: 1 col mobile, 2 col tablet, 3 col desktop
- Loading state: 6 skeleton cards
- Error state: full-width banner with retry button
- Empty state: contextual message per active filter

### `components/discover/EmptyState.tsx`
- Zero results after filters: `No matches. Try clearing filters or
  widening your search.` + Clear filters button
- Live now toggle on with no results: `No live shows right now.` +
  `View all sellers →` (clears live filter only)

### `components/discover/MerchantStrip.tsx`
- Single dark strip at bottom of grid
- Copy: `Own a local business? Flat $29/mo, 0% commission. First 100
  merchants lock in forever.` → `Become a founding merchant`
- Links to `/merchant`
- This is the ONLY seller-recruitment CTA on /discover

---

## Logic files to create

### `lib/discover/types.ts`
- `ListingCardVM` type
- Filter/sort type unions
- Re-export shared types from `lib/categories.ts`

### `lib/discover/filters.ts`
Pure functions extracted from current page.tsx:
- `lowestOfferPrice(project): number | null`
- `hasOffers(project): boolean`
- `offerCount(project): number`
- `hasSubscription(project): boolean`
- `getProjectEmoji(project, index): string`
- `filterProjects(projects, filters): Project[]`
- `sortProjects(projects, sortId, marketByProject): Project[]`

Do NOT extract `projectReadinessScore` — Pass 1 doesn't use it.
Leave it in the old file if anything else references it.

### `lib/discover/useMarketBatch.ts`
- Batch `/api/projects/{id}/market` calls in chunks of 8
- `Promise.allSettled` per chunk
- Returns `Record<string, MarketSnapshot>`
- Cache with 30s stale time

### `lib/discover/useProjects.ts`
- Wraps `/api/projects/public` fetch
- Calls `useMarketBatch` after projects load
- Polls every 45s (visibility-aware: pauses when tab hidden)
- Returns `{ projects, marketByProject, loading, error }`

---

## Filtering / sorting behavior (client-side)

Apply in this order:
1. Drop listings with offersCount === 0 OR title starts with
   "Auto-created" / "No description" OR description length < 20
2. Apply search (title + description + ownerName, case-insensitive)
3. Apply category filter if selected
4. Apply price filter using lowestOfferPrice (cards missing price fall
   through on "Any", excluded when bound is set)
5. Apply "Live now" toggle on isLive
6. Apply "Deals only" toggle on hasPromo — if no project has
   promo_copy, hide the toggle entirely
7. Sort by selected key; "Nearest" hidden in Pass 1

**Scroll behavior:** Preserve scroll position on filter changes.
Reset to top only on search text changes.

---

## Files to create

```
components/discover/DiscoverHero.tsx
components/discover/TrustStrip.tsx
components/discover/StickyFilterBar.tsx
components/discover/LiveRail.tsx
components/discover/ListingCard.tsx
components/discover/ListingGrid.tsx
components/discover/EmptyState.tsx
components/discover/MerchantStrip.tsx
lib/discover/types.ts
lib/discover/filters.ts
lib/discover/useMarketBatch.ts
lib/discover/useProjects.ts
app/discover/page.tsx          (rebuild — replaces existing)
app/discover/loading.tsx       (skeleton grid)
```

## Files to modify

```
components/Navbar.tsx          (hide "Go Live" for non-merchant roles)
```

## Files NOT touched in Pass 1

```
app/api/*                      (no backend changes)
app/layout.tsx                 (no global PointsWallet mount)
components/points/*            (not extended)
any database migration         (forbidden by Phase 0B gate)
/merchant, /business, /project/:id  (out of scope)
components/Starfield.tsx       (keep; other pages use it)
```

---

## Acceptance tests (must pass before merge)

1. No card renders with "Profile strength," "Top 10/50/100,"
   "#N Trending," or "View Project →".
2. Cards with no offers or titles starting with "Auto-created" /
   "No description" do not appear in the grid.
3. The hero subheadline renders in full on a 1440x900 viewport
   (regression on current "any" bug).
4. On scroll, the filter bar sticks below the header with a shadow.
5. Live rail returns null when no card has isLive: true; no empty
   shell renders in the DOM.
6. "Live now" toggle is disabled with tooltip when no live results;
   "Deals only" toggle is hidden when no project has promo_copy.
7. First paint of the grid waits for the first market batch (8
   calls); cards never appear then vanish due to zero offers.
8. /discover makes exactly one /api/projects/public call on initial
   render plus at most ceil(n/8) parallel batches of /market calls.
9. No PointsWallet component, no points balance, and no redemption
   UI appear anywhere on /discover (grep guard).
10. "Go Live" button is not rendered for users whose role is not
    merchant on their own project.
11. Lighthouse Performance >= 85 mobile on /discover with current data.
12. All existing URLs and query params for sort/price/live/deals
    and ?q= and ?category= continue to work.

---

## Non-goals for Pass 1 (refuse to add these)

- PostGIS, geo radius, LocationPicker
- Follows, notifications, SMS opt-in
- Reviews, ratings display, sold counts
- Live viewer count, upcoming rail, scheduled shows
- PointsWallet drawer, balance pill, earn-rate on cards, redemption
- Auctions, bids, drops, countdowns
- New API routes or schema migrations
- Mux autoplay on grid cards (player stays on /project/:id only)
- Any change that requires a second seller or first paid transaction

If any of these show up in a PR, it is out of scope — reject and
queue for Pass 2.

---

## Pre-flight checklist

1. [ ] This task file committed
2. [ ] Confirmed endpoint: /api/projects/public returns the expected
       shape (title, description, owner, is_live, store_items)
3. [ ] components/discover/ directory created
4. [ ] lib/discover/ directory created

---

## Build order

1. lib/discover/types.ts
2. lib/discover/filters.ts (extract from current page.tsx)
3. lib/discover/useMarketBatch.ts
4. lib/discover/useProjects.ts
5. Presentational components (parallel — no interdependencies):
   - DiscoverHero, TrustStrip, StickyFilterBar, LiveRail,
     ListingCard, ListingGrid, EmptyState, MerchantStrip
6. app/discover/page.tsx (rebuild — orchestrate all pieces)
7. app/discover/loading.tsx (skeleton)
8. Navbar.tsx modification (hide Go Live for non-merchants)
9. Test: npm run build, verify no type errors
10. Verify acceptance tests 1-12

---

## Grep guards (CI / manual check before merge)

`components/discover/*.tsx` must NOT contain:
- `PointsWallet`
- `profile_strength`
- `profileStrength`
- `Top 10`
- `Top 50`
- `Trending`
- `View Project`
- `projectReadinessScore`

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
