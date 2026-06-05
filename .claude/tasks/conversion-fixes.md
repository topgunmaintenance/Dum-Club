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

## P2 — Publish Store toggle (DRAFT → PUBLISHED)

Add a "Publish Store" toggle, separate from Go Live streaming, that
moves shop status DRAFT → PUBLISHED so the storefront is buyable
without a live stream. Reuse the existing store-status plumbing
(`frontend/lib/storeStatus.ts` and its backend route). Do NOT couple
publish state to streaming state.

## P3 — Onboarding checklist: "Add first offer" gated on Published

Fix the onboarding checklist so "Add first offer" is marked complete
ONLY when the shop is Published, not merely when an offer is saved.

## P11 — Public storefront ABOUT section empty-state handling

In the public storefront ABOUT section: when `description` is empty,
hide the section entirely for non-owners. For owners, show an inline
prompt to add a description instead of an empty block.

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
