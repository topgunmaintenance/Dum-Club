# Simplification copy — Phase 4 source-of-truth

This doc holds the exact, founder-approved rewrites used by Phase 4 of
the pre-launch plan. **Wait for the user's paste in chat before editing
any frontend files.** Inventing copy on the engineering side has been
explicitly forbidden.

## Universal word swaps (already canonical)

These are global rules — every user-facing string in `frontend/app/` and
`frontend/components/` should follow them. The `npm run check:human-copy`
script will be extended in PR #208 to fail the build when any of the
left-side strings appears in JSX text or string literals.

| Old | New |
|---|---|
| Embed / script tag | "one line of code" |
| Stripe Connect / Stripe direct payouts | "money goes straight to your bank" |
| Pinned offer | "Main deal" |
| Bubble *(display mode)* | "Chat circle in the corner" |
| Full Sale *(display mode)* | "Big shop window on the page" |
| Display mode | "How it looks on your site" |
| Command Center | "Dashboard" |
| Explore / Discover *(nav + page titles only)* | "Shop" |
| Storefront | "your shop page" |
| DUM Points *(first mention per page)* | "Reward stamps (DUM Points)" |
| Founding merchant | "one of our first 100 shops" |
| Pop-In | "Welcome message" |
| Marketplace | "Shop page" |

The 60-day trial banner copy is exempt — `past_due` / `suspended` raw
status strings must never appear, but the banner copy is finished and
correct as of PR #207.

## Priority pages — copy block placeholders

Paste the founder-approved block for each section below, replacing the
`<<< PASTE: ... >>>` marker. Engineering will then match it exactly.

### Homepage hero

```
<<< PASTE: Hero copy block (eyebrow, headline, subhead, secondary subhead, primary + secondary CTA labels) >>>
```

### Homepage "How it works"

The 6-step list shipped in PR #204 reads:

```
01 Connect Stripe        - One click. Money goes straight to your bank.
02 Create a Deal         - Pick what you sell and set a price.
03 Add DUM Club to Your Website - Paste one line of code. A small bubble
                                  appears in the corner of your site.
04 Go Live               - Camera on. Customers watch on your website.
05 Customers Buy         - One tap. Stripe handles payment.
06 You Get Paid          - Direct deposit. You keep every dollar.
```

If any line needs swapping (e.g. step 3's "bubble" → "Chat circle in the
corner"), paste the replacement below:

```
<<< PASTE: How-it-works step rewrites (or "keep as-is") >>>
```

### Dashboard

Top welcome / next-step copy:
```
<<< PASTE: Dashboard welcome copy >>>
```

GetLiveSteps (5-step grid currently reads: Business name set / Connect
Stripe / Create a Deal / Add DUM Club to Your Website / Press Go Live):
```
<<< PASTE: GetLiveSteps tweaks (or "keep as-is") >>>
```

### Merchant signup

```
<<< PASTE: /merchant hero, helper text, button labels >>>
```

### Pricing page

Already shows Starter / Growth / Pro / Business / Enterprise tiers per
the existing `frontend/app/pricing/page.tsx`. Phase 4 visibility rule:
show only Starter/Growth/Pro by default, hide Business + Enterprise
behind a "Need a bigger plan? →" text link. FAQ: pre-open the top 2.

If tier copy needs rewrites:
```
<<< PASTE: Pricing tier description rewrites (or "keep as-is") >>>
```

### For Business

```
<<< PASTE: /business hero + section copy >>>
```

### Discover / Shop

Phase 4 rule: rename nav label and page heading from "Discover" to
"Shop". Page-body copy:
```
<<< PASTE: /discover (now /shop) heading + subhead >>>
```

### Nav

Desktop + mobile nav link labels. Current labels are: Explore (→ Shop
per swap rule), For Business, Merchant, About, Go Live.

```
<<< PASTE: Nav label rewrites (or "keep as-is") >>>
```

### Footer

Already plain. If anything reads stiff, paste replacements:

```
<<< PASTE: Footer tweaks (or "keep as-is") >>>
```

## Dashboard progressive disclosure (Phase 4 — implementation rules)

Gated behind `SIMPLIFIED_DASHBOARD` env / config flag (default `false`
in production until founder flips). Rules:

- If onboarding < 5/5 complete: show top banner + ONE big card for next
  step + small "Your Businesses" list. Hide everything else.
- If onboarding complete: show action grid (Share / Manage / Orders).
  Move Display Mode + Welcome Message into a collapsed "Settings"
  section.
- Default Display Mode to "Let us pick for you" (recommended).
- Welcome Message panel: show preview + "Customize" button. Hide 8
  fields until Customize clicked.
- Sales ticker: filter items containing "test"/"testing" or amount <
  $1. Remove ticker from `/dashboard` entirely. Keep on homepage only.

These are not copy decisions — engineering implements directly when
PR #208 lands.

## Reading-level rule

Max 18 words per sentence in marketing copy. `npm run check:human-copy`
will be extended in PR #208 to flag any string > 18 words in
`frontend/app/{page,business,pricing,merchant}/**/*.tsx` if feasible.
