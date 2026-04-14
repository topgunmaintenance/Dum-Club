# CURRENT_SPRINT.md — Phase 0B + Phase 1 Prep
# Updated: April 2026

## Sprint Goal

Complete Phase 0B: get Topgun Maintenance live as a verified
founding merchant and close one real paid Stripe transaction.
Then immediately execute Phase 1 Whatnot seller outreach and
homepage redesign.

---

## Phase 0B Tasks — DO THESE FIRST

- [ ] 1. Remove DUM Points link from navbar
         File: frontend/components/Navbar.tsx
         Both mobile AND desktop nav menus
         /hub still works at direct URL — just not in nav

- [ ] 2. Bump FOUNDING_CAP from current value → 100
         File: backend/api/routes/merchant.py
         Update ALL hardcoded references in frontend copy too
         Update all email templates to say "100 founding sellers"
         Update all banners and CTAs

- [ ] 3. Build Topgun Maintenance storefront
         Full spec in CLAUDE.md Section 7
         Slug: topgun-maintenance
         All 6 services with prices
         All 5 photos from topgunmaintenance.com
         verified=true, visibility=public, profile_strength=100
         Pinned first on /discover

- [ ] 4. Update homepage comparison table
         REMOVE: Base44, Lovable, Venice.ai, Angi, Thumbtack
         ADD: Whatnot (8%+2.9%), Commonsold (% fees),
              Google Maps (pay to rank)
         DUM Club column: Flat $29-$99/month, 0% per sale

- [ ] 5. Get 1 real paid Stripe transaction
         Send storefront link to 20 real contacts
         This is the Phase 1 unlock condition

---

## Phase 1 Tasks — LOCKED until Phase 0B complete

- [ ] 1. Whatnot seller scraping agent
         File: backend/agents/whatnot_scraper.py
         Target: active sellers last 30 days
         Categories: Sports Cards, Collectibles, Sneakers,
         Streetwear, Pokémon, Comics, Vintage
         Output: /data/whatnot_sellers.csv
         Connect to: backend/services/email.py pipeline

- [ ] 2. Update all 4 outreach email templates
         Pitch: flat $29/month vs Whatnot's 8% per sale
         On $10k/month = $800+ saved every month
         100 founding slots — $0 during founding period

- [ ] 3. Homepage redesign — Whatnot visual energy
         Hero: "Sell Live. Pay a Flat Fee. Keep the Rest."
         Founding 100 banner: real slot counter from API
         Live Now grid: AWS IVS (when is_live=true)
         Best Deals This Week section
         Fee comparison: Whatnot/Commonsold vs DUM Club flat fee
         Category browse: Cards/Sneakers/Collectibles/
                          Streetwear/Local Services/Digital Goods
         Google reviews displayed per business
         No DUM Points mentions anywhere

- [ ] 4. Activate AWS IVS live selling
         "Go Live" button on merchant dashboard
         Sets is_live=true, starts IVS stream
         Live indicator on Discover card
         /live/[slug] viewer page
         "End Stream" button
         Mobile-first

---

## What Is Locked — Do Not Touch

- DUM Points backend or /hub page content
- /technology page
- Solana claim flow
- Restaurant vertical
- City replication
- B2B white-label (Phase 4)
- Square/PayPal/GoDaddy payment integrations
- Any % fee on transactions
