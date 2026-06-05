# Task: conversion-fixes

Source: Conversion audit (2026-06-05). Ten discrete fixes that
remove dead-ends and friction in the buyer + merchant-onboarding
funnel. Each task is independent and ships as ONE commit per the
COMMIT RULE. Execute in the order listed below unless told
otherwise.

These are surgical fixes. Reuse existing components, existing
Tailwind tokens, existing Stripe checkout + store-status plumbing.
Do NOT add dependencies. Do NOT redesign surrounding UI. Frontend
only unless a task explicitly calls for backend work.

---

## Execution order

P15 → P5 → P1 → P2 → P3 → P11 → P10 → P6 → P13 → P16

---

## P15 — Hide GO LIVE floating button on public/marketing pages

The persistent "Go Live" pill (`frontend/components/FloatingGoLive.tsx`,
mounted globally by `SiteChrome`) currently shows on every non-embed
route except `/project/*`. That leaks it onto `/`, `/pricing`,
`/about`, `/why-dum-club`, `/discover`, `/for-business` and other
public/marketing surfaces where it confuses visitors.

Scope: restrict visibility to authenticated merchant work surfaces
only. The button must NOT render on any public/marketing page.
Keep all existing gating (signed-in, owns a project, has an active
offer, Stripe-verified). This is a gating change only — no visual
or behavioral change to the pill itself.

Likely files: `frontend/components/FloatingGoLive.tsx` only.

## P5 — Hide Edit button on offer cards in the public/customer view

The offer card's Edit button must only render when `isOwner === true`.
In the customer/public view it should not appear at all.

## P1 — Add Buy Now button to offer cards (customer view) — CRITICAL

Customers currently have NO way to purchase. Add a "Buy Now" button
to offer cards in the customer view that triggers the EXISTING Stripe
checkout flow. Reuse the existing checkout call path — do not build a
new checkout. This is the highest-priority fix in this file.

**Status: RESOLVED-BY-P5 (no code change).** Investigation found the
Buy/Book button already exists in each offer card's action area
(`frontend/app/project/[id]/page.tsx`) and is rendered for every
non-owner — logged-out and logged-in alike. It calls the existing
`buyOffer` handler, which is built for guest checkout: the bearer
token is optional, the backend mints a `guest:<token>` buyer id, and
Stripe collects the buyer email at the payment step. There is NO
login wall on the primary Stripe CTA (only the secondary SOL button
requires sign-in). The reason the audit saw "no buy path" was the P5
leak: owners previewing as a customer saw the Edit button instead of
Buy/Book. P5 fixed that, so the customer view now correctly shows the
working Buy/Book button in every case.

## P2 — Publish Store toggle (DRAFT → PUBLISHED)

Add a "Publish Store" toggle, separate from Go Live streaming, that
moves shop status DRAFT → PUBLISHED so the storefront is buyable
without a live stream. Reuse the existing store-status plumbing
(`frontend/lib/storeStatus.ts` and its backend route). Do NOT couple
publish state to streaming state.

**Status: DONE (authed-endpoint approach).** Before this, the only
path to `status='live'` was the deprecated Solana token pipeline, so
merchants had no way to publish. Added owner-gated
`POST /api/projects/{id}/publish` + `/unpublish` (same ownership check
as `/go-live`, requires the `user_id` privy header) that flip
`projects.status` draft↔live — kept out of the generic PATCH whitelist
because that endpoint's ownership check is optional. Frontend adds a
"Publish Store" / "Unpublish" toggle in the owner Store Status card
(`/project/[id]`), shown once the store has an offer, fully separate
from Go Live broadcasting. Buyability is unchanged (governed by
`visibility`, public by default); publishing is what lists the store
on Discover and advances the Store Status card.
Files: `backend/api/routes/projects.py`,
`frontend/app/project/[id]/page.tsx`.

## P3 — Onboarding checklist: "Add first offer" gated on Published

Fix the onboarding checklist so "Add first offer" is marked complete
ONLY when the shop is Published, not merely when an offer is saved.

**Status: DONE.** The onboarding checklist is `GetLiveSteps` ("Your
Launch Checklist"). Step 3 ("Add what you sell") was `done: hasOffer`;
now `done: hasOffer && isPublished` (storefront `status === "live"`,
the P2 publish state). Added an `isPublished` prop wired from the
dashboard's `primary.status`. When an offer exists but the store is
still a draft, step 3 stays open and its CTA becomes "Publish store",
pointing at the Publish Store toggle on the storefront — so the step
doesn't dead-end as an unchecked "Add another".
Files: `frontend/components/GetLiveSteps.tsx`,
`frontend/app/dashboard/page.tsx`.

## P11 — Public storefront ABOUT section empty-state handling

In the public storefront ABOUT section: when `description` is empty,
hide the section entirely for non-owners. For owners, show an inline
prompt to add a description instead of an empty block.

**Status: DONE.** Rewrote the ABOUT block in
`frontend/app/project/[id]/page.tsx`. Empty now also covers the
auto-generated placeholders ("Auto-created from dashboard.",
"Project workspace for …"). When empty: visitors (and owners in
view-as-customer preview) get nothing — the whole `#section-about`
block is removed, and `SectionNav` already drops the dot for absent
sections (passed a load-aware `refreshKey` so it re-scans once the
project loads). Owners see a dashed-border prompt with an "Add
description" CTA linking to `/project/[id]/manage#settings`. The old
"No description available yet." filler is gone.

## P10 — Require category on "Create Your Shop"

During the Create Your Shop step, require a category selection from
exactly: Restaurant, Auto & Repair, HVAC, Gym & Wellness, Retail,
Service, Other. Block progression until one is chosen.

## P6 — "No credit card required" under hero CTA

Add "No credit card required" text directly under the START FREE FOR
60 DAYS button in the homepage hero. Plain copy, no dashes (human-copy
guard applies).

## P13 — Gate the Share Shop CTA

Show the Share Shop CTA as disabled, with a tooltip reading
"Complete your profile first", until BOTH description and category
are filled. Enable it once both are present.

## P16 — Expand two FAQ items on /pricing by default

On `/pricing`, the "Can I cancel any time" and "Do I need to
integrate Stripe" FAQ items should render expanded by default.

---

> Do not modify any code outside the named files for this task.
> If more files are needed, stop and ask first.
