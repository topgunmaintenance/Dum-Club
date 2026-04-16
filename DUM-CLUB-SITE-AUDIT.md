# DUM Club Full Site Audit — April 14, 2026
## Strategic Recommendations + Claude Code Prompts

---

## CRITICAL BUGS (Ship today)

### 1. Homepage has a massive black void
After the FounderNote ("I'm Julian..."), there are thousands of pixels of pure black before the "Try an Example" section. This is the #1 conversion killer — visitors scroll once past the hero and think the page is broken.

**Claude Code prompt:**
```
The homepage at frontend/app/page.tsx has a massive empty black space between the FounderNote/ProofOfMotion section and the "Try an Example" category pills. This is caused by hidden or empty sections that take up vertical space but render nothing visible. Audit the page from the ProofOfMotion component down to the "Try an example" section. Remove or collapse any empty containers, hidden divs with large min-heights, or conditionally-rendered sections that produce blank space when their data is empty. The goal is zero dead space — FounderNote should flow directly into the category pills with normal section spacing (py-16 max). Do NOT delete the sections themselves if they have content — just fix the spacing when content is absent.
```

### 2. /discover shows 0 businesses, 0 offers — Topgun missing
The discover page says "No businesses in this category yet" even though Topgun Maintenance is seeded in the database with status=live, review_status=approved, visibility=public. The /api/projects/public endpoint likely isn't returning it because of a filter mismatch (maybe checking `visibility` or `wallet_address` against the seed value).

**Claude Code prompt:**
```
The /discover page shows 0 businesses even though the Topgun Maintenance project exists in Supabase with status='live', review_status='approved', slug='topgun-maintenance'. The issue is in the backend at backend/api/routes/projects.py in the GET /api/projects/public endpoint. The query filters likely exclude Topgun because either: (a) it checks wallet_address and ours is 'seed:topgun-maintenance' (not a real wallet), (b) it checks a visibility column that doesn't match, or (c) there's a join condition that fails. Debug the /api/projects/public query, identify why Topgun is excluded, and fix it so verified founding merchants appear on /discover. The fix should be minimal — add an OR condition for verified=true projects, or relax the wallet_address check for seeded merchants. Push directly to main.
```

### 3. /business page is completely blank
The "For Business" nav link goes to /business which is an empty black page with just stars. This is a dead end for any merchant prospect clicking from the navbar.

**Claude Code prompt:**
```
The /business page at frontend/app/business/page.tsx renders as a completely blank page. This is linked from the main navbar "For Business" button. Either: (a) build a proper landing page targeting merchant prospects with the v5.0 value prop (flat $29-$99/mo, 0% commission, AI retention, loyalty built in — see CLAUDE.md Section 3 for tier details), or (b) redirect /business to /merchant which already has a working signup flow. Option (a) is preferred — create a seller-focused landing page with: hero ("Keep everything you earn"), fee comparison table (Whatnot 8%+2.9% vs DUM Club flat fee), 3 tier cards (Starter $29, Growth $49, Pro $99), founding 100 CTA, and a "Talk to Julian" contact section. Push to main.
```

### 4. Comparison table still says Base44/Lovable/Venice.ai
The homepage "Why Us" section compares DUM Club to AI app builders instead of Whatnot/Commonsold/Google Maps. This is the old v1 framing. The fix was written (commit 3cc933f) but never landed on main.

**Claude Code prompt:**
```
The homepage comparison table in frontend/app/page.tsx (around the "Why Us" / "The real difference" section) still compares DUM Club to Base44, Lovable, and Venice.ai. Per CLAUDE.md v5.0 Section 11, we ONLY compare to Whatnot, Commonsold, and Google Maps. Replace the comparison table entirely:

Features tab columns: Whatnot / Commonsold / Google Maps / DUM Club
Rows: Fee model (8%+2.9% / % per sale / Pay for ads / Flat $29-$99/mo), Per-sale commission (8% / % / — / 0% ever), Live selling (Yes/Yes/No/Yes), Local discovery (No/No/Pay to rank/Free+deals), Loyalty (None/Basic/None/Every tier), AI retention (None/None/None/Built in), AI social media (None/None/None/Pro tier), White-label loyalty (None/None/None/$499/mo+)

Cost tab: show what platforms actually cost on $10k/mo GMV — Whatnot ~$1,090, Commonsold $500+, Google $500-2000/mo ads, DUM Club flat $29-99.

Remove ALL references to Base44, Lovable, Venice.ai, and the "AI tools build apps" framing. Push to main.
```

### 5. /merchant page shows Square payment option
Doctrine rule #11: "Stripe is the ONLY payment processor — no exceptions." The merchant dashboard shows a Square "Connect" button alongside Stripe.

**Claude Code prompt:**
```
In frontend/app/merchant/page.tsx, the Payment Connections section shows both Stripe and Square connect buttons. Per CLAUDE.md rule #11, Stripe is the ONLY payment processor. Remove the Square connect button and any Square-related code from the merchant page. Also fix "Topgun Maintenance L.L.C" to "Topgun Maintenance LLC" (no periods) and "Dover, NJ" to "Morristown, NJ" if those are rendered from the merchant profile data. Push to main.
```

### 6. FounderNote still mentions DoorDash/Angi/Dover
Doctrine rule #6: "Never compare to Angi, Thumbtack, DoorDash." The FounderNote component still says "handing 30% to DoorDash and 25% to Angi" and "Dover, NJ."

**Claude Code prompt:**
```
In frontend/components/FounderNote.tsx: (1) Change img src from "/julian.jpg" to "/Julian.jpeg", (2) Change avatar border to "border-2 border-emerald-400/25" with shadow glow, (3) Replace copy: "I run a maintenance business in Dover and I was tired of handing 30% to DoorDash and 25% to Angi" → "I run an aircraft maintenance shop at Morristown Municipal and I was tired of platforms taking 8-30% of every sale. Flat fee, zero commission, keep everything you earn", (4) Change "Dover, NJ" → "Morristown, NJ", (5) "Topgun Maintenance" → "Topgun Maintenance LLC". Push to main.
```

---

## STRATEGIC RECOMMENDATIONS (To beat Whatnot, Google, Angi)

### A. Become the local search destination (Beat Google Business)

Google Maps makes businesses pay for ads to be seen. DUM Club should be where people GO to find local deals without the pay-to-rank model. This requires:

**1. SEO-first category pages**
Every city + category combo needs a static page that Google can index: "Aircraft Maintenance Morristown NJ", "Pizza Delivery Morris County", "Mobile Detailing Dover NJ". These pages should exist even before sellers join — showing the DUM Club value prop and a "Be the first [category] on DUM Club" CTA.

**Claude Code prompt:**
```
Create a dynamic route at frontend/app/[city]/[category]/page.tsx that generates SEO-optimized category landing pages. Each page should have: (1) an H1 like "Best [Category] in [City], NJ", (2) structured data (JSON-LD LocalBusiness schema), (3) a list of DUM Club merchants in that category (from /api/projects/public filtered by city+category), (4) if no merchants exist yet: a "Be the first [category] on DUM Club — $0/month for founding members" CTA linking to /merchant, (5) meta title/description optimized for "[category] near me [city]" searches. Start with these cities: Morristown, Dover, Parsippany, Madison, Chatham, Morris Plains. Categories: restaurants, auto-services, home-services, health-wellness, pet-services, beauty. Generate a sitemap.xml entry for each combo. This is the #1 lever for organic traffic.
```

**2. Google Reviews integration on storefronts**
Every storefront should pull and display the merchant's Google reviews. This gives DUM Club pages MORE trust signals than the Google listing itself (because we also show deals + loyalty).

**Claude Code prompt:**
```
Add a Google Reviews section to the project storefront page at frontend/app/project/[id]/page.tsx. When a project has a google_place_id in its ai_output JSONB, fetch reviews from the backend (which uses the Google Places API — the key is already in Railway env vars as GOOGLE_MAPS_API_KEY). Display: star rating, review count, and the 3 most recent 4-5 star reviews with reviewer name and snippet. This makes DUM Club storefronts more trustworthy than Google Business profiles because we show reviews + deals + loyalty in one place. Add a google_place_id field to the project seed for Topgun Maintenance (look up the real Google Place ID for Topgun Maintenance LLC Morristown NJ).
```

### B. Kill Whatnot's fee advantage (The $0 commission pitch)

Whatnot takes 8% + 2.9% + $0.30 per sale. On $10k/month that's over $1,000 gone. DUM Club's flat fee means sellers keep EVERYTHING after their $29-99/month. This needs to be the loudest message on the site.

**3. Fee calculator on homepage**
Let sellers type their monthly sales volume and instantly see how much they'd save vs Whatnot.

**Claude Code prompt:**
```
Add an interactive fee calculator component to the homepage at frontend/app/page.tsx, placed between the FounderNote and the "How it works" section. The calculator should have: (1) a slider or input for "Monthly sales volume" ($1k to $100k), (2) three result cards showing: Whatnot fees (8% + 2.9% + $0.30 per avg transaction of $50), Commonsold fees (estimated 5% + $49/mo), DUM Club fee (flat $49/mo — Growth tier), (3) a big green number showing "You save $X,XXX/year with DUM Club", (4) a CTA "Start selling — first 100 merchants are free." Use emerald accent for the savings number. Make it responsive. This is the single most persuasive element for seller recruitment.
```

**4. Whatnot seller migration landing page**
A dedicated page at /from-whatnot that speaks directly to Whatnot sellers frustrated with fees.

**Claude Code prompt:**
```
Create a new page at frontend/app/from-whatnot/page.tsx targeting Whatnot sellers. Headline: "Tired of giving Whatnot 11% of every sale?" Content: (1) fee breakdown showing what Whatnot takes on $5k, $10k, $25k monthly sales, (2) "Switch to DUM Club: flat $29-99/month, keep 100% of your sales", (3) 3 steps to migrate: sign up, connect Stripe, import your catalog, (4) founding 100 offer, (5) "Talk to Julian" CTA with phone number. Meta title: "Switch from Whatnot to DUM Club — Keep 100% of Your Sales". This page is for paid ads and direct outreach to Whatnot sellers.
```

### C. Make the loyalty network visible (The moat)

DUM Points are the reason sellers stay and buyers return. But right now they're invisible. Even in Phase 0B, the CONCEPT needs to be front and center — even if the purchase/redeem flow isn't live yet.

**5. Show points earning on every transaction**
When someone buys an offer, the confirmation should show "+X DUM Points earned — use at any business on DUM Club." This plants the seed even before the redemption flow is live.

**Claude Code prompt:**
```
After a successful Stripe checkout on the project storefront page, show a purchase confirmation modal/toast that includes: (1) "Purchase complete — $X paid via Stripe", (2) "+X DUM Points earned" (calculate as 1 point per $10 spent, rounded down), (3) "Use your points for 10% off at ANY business on DUM Club", (4) "Browse more businesses →" link to /discover. This makes the cross-merchant loyalty loop tangible from the very first transaction. The points don't need to be tracked in the DB yet for Phase 0B — just show the visual. We'll wire up real tracking in Phase 2.
```

**6. "Deals This Week" section on discover**
Discover needs a curated "Best Deals This Week" section at the top — this is what brings buyers BACK weekly, like checking the Costco flyer.

**Claude Code prompt:**
```
Add a "Best Deals This Week" hero section at the top of the /discover page (frontend/app/discover/page.tsx), above the category tabs. Show the 3-6 lowest-priced or most recently updated offers across all merchants with: offer title, price, merchant name, and a "Book Now →" link to the storefront. If there aren't enough offers, show a "More deals coming this week — check back soon" message with the founding 100 CTA. This section is what makes DUM Club a destination people check weekly, like a digital coupon book.
```

### D. Fix the identity crisis

The homepage currently tries to be three things: an AI business builder ("Describe what you sell"), a marketplace ("Start Shopping"), and a loyalty network ("Earn rewards everywhere"). Pick ONE hero message for ONE audience.

**7. Homepage redesign — seller-first hero**
Phase 0B is about recruiting sellers. The homepage should speak to SELLERS, not buyers. Buyers come after you have inventory.

**Claude Code prompt:**
```
Redesign the homepage hero section in frontend/app/page.tsx. Remove the "What do you want to find or build?" textarea and the AI business builder flow — that's v1 positioning (CLAUDE.md says "We are NOT an AI business launcher"). Replace with a seller-focused hero:

Hero headline: "Sell live. Keep everything."
Subhead: "Flat $29-99/month. Zero commission. The first 100 merchants are free."
Two CTAs: "Claim Your Free Spot →" (links to /merchant) and "Browse the Marketplace →" (links to /discover)

Below the hero, show: (1) the fee calculator, (2) the FounderNote with Julian's photo, (3) "How it works" for sellers (List → Sell → Keep everything), (4) the comparison table (Whatnot/Commonsold/Google vs DUM Club), (5) the AI assistant demo with Topgun, (6) founding 100 counter showing real slots remaining.

Remove: the Sparkle Mobile Wash AI builder demo, the "idea to revenue" animation, the category example pills, and any "describe what you need" language. The page should feel like Whatnot's homepage but for local services — not like a no-code app builder.
```

### E. Mobile-first (where your sellers AND buyers are)

Whatnot is mobile-first. Most local service discovery happens on phones. The current site has major mobile issues (duplicate heroes were fixed, but spacing and nav are still rough).

**8. Mobile nav cleanup**
```
Audit the mobile hamburger menu in frontend/components/Navbar.tsx. When open, it should show: Discover, For Business, Merchant (if logged in), and a prominent "Claim Free Spot" CTA button in emerald. Remove any links to pages that are blank or broken (/business if not fixed, /hub, etc.). The mobile menu should load fast and be thumb-friendly — large tap targets, no nested dropdowns.
```

---

## PRIORITY ORDER

1. Fix the black void on homepage (immediate — people are bouncing)
2. Fix /discover to show Topgun (immediate — the storefront exists but nobody can find it)
3. Fix comparison table to Whatnot/Commonsold/Google (immediate — wrong competitors)
4. Fix FounderNote + remove Square from merchant page (quick wins)
5. Build /business landing page (this week — seller recruitment page)
6. Add fee calculator to homepage (this week — the persuasion tool)
7. SEO category pages (this week — organic traffic engine)
8. Homepage hero redesign (next week — big change, needs review)
9. Google Reviews on storefronts (Phase 1)
10. Whatnot migration page (Phase 1 — for outreach campaigns)

---

## STILL OUTSTANDING FROM EARLIER SESSIONS

- [ ] Run `bash scripts/fetch-topgun-photos.sh` locally and commit 5 plane photos
- [ ] Deploy FounderNote fix (Julian.jpeg + copy update) — prompt already given above
- [ ] Claim the seed Topgun project row with Julian's real Privy DID after first signin
- [ ] Homepage comparison table commit 3cc933f never landed on main — reapply
