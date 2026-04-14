# CLAUDE.md v5.0 — DUM Club Master Doctrine
# Effective: April 2026
# Supersedes: All previous versions

---

## 1. WHO WE ARE

DUM Club is a live selling marketplace and local business
discovery platform built on a flat monthly fee model.

We compete directly with Whatnot and Commonsold.

Whatnot charges 8% per sale plus 2.9% processing.
Commonsold charges per-sale fees plus monthly fees.
DUM Club charges a flat $29-$99/month. That's it.
No percentage cut. No per-sale fee. Ever.

We also replace Google Maps for local business discovery —
showing real deals, live sellers, and Google reviews in one
place without businesses paying for Google Ads to be seen.

We are entertainment first. Commerce second.
We are the loyalty network that replaces direct mail.
We are the AI social media service replacing agencies.

We are NOT:
- A delivery platform
- A crypto app (Solana is future, optional, legal-pending)
- An AI business launcher (deprecated — v1 positioning)
- Competing with Angi or Thumbtack
- Charging per-sale commissions ever

We ARE competing with:
- Whatnot (8% + 2.9% per sale vs our flat $29-$99/month)
- Commonsold (% fees + monthly vs our flat fee only)
- Google Maps (pay-to-rank vs our free display + deals)
- Yotpo/Smile.io ($199-$999/month loyalty only vs our
  full platform with loyalty built into every tier)
- Direct mail agencies ($500-$2,000/month vs our $49/month
  AI retention program)

---

## 2. THE CORE LOOP

Browse live sellers + best local deals this week
→ Watch / discover → Buy via Stripe direct
→ Seller keeps everything (flat fee already paid)
→ Buyer earns DUM Points automatically (Phase 2+)
→ Points bring buyer back to ANY business on network
→ Seller retains customer without lifting a finger

---

## 3. PRICING MODEL

### Founding 100 Sellers
- $0 during founding period
- Locked into $29/month after founding period ends
- Founding seller badge permanent on their profile
- FOUNDING_CAP = 100 (constant in backend/api/routes/merchant.py)
- After slot 100: standard tiers apply to everyone new

### Standard Tiers (seller 101+)

**Starter — $29/month**
- Storefront on DUM Club marketplace
- DUM Points built in automatically
- Basic sales analytics
- Stripe direct payouts
- Listed on Discover page

**Growth — $49/month**
- Everything in Starter
- Featured placement in category browse
- AI retention agent (automated point reminders to customers)
- Google review display on storefront
- Best Deals This Week eligibility

**Pro — $99/month**
- Everything in Growth
- AI social media management
  (Instagram/TikTok/Facebook automated posting)
- Homepage featured slot
- Cross-business deal promotions
- Full analytics dashboard
- Priority placement in search

**Business — $499/month (white-label)**
- DUM Points under YOUR brand name
- Custom rewards rules and earning rates
- API access for your own platform
- Dedicated AI retention agent
- For mid-size businesses wanting their own loyalty program
  without building infrastructure

**Enterprise — $2,000+/month**
- Full white-label loyalty infrastructure
- Custom integrations (POS, CRM, ERP)
- Multi-location support
- Dedicated account manager
- For hotel chains, retail chains, franchise networks

### Never
- Never charge a % of sales
- Never charge per transaction to sellers
- Never charge listing fees
- Stripe processing fees (2.9% + $0.30) are paid by
  the buyer as part of checkout — not by the seller

---

## 4. REVENUE STREAMS

**Stream 1: Flat monthly subscriptions**
$29-$2,000+/month per seller depending on tier
Predictable, recurring, scales with seller count

**Stream 2: On-site advertising**
- Featured placement in Best Deals This Week: $99/month
- Category sponsorship: $49/month per category
- Homepage banner: $199/month
- Sold to merchants already on the platform

**Stream 3: AI Social Media Service (included in Pro)**
Replace $500-$2,000/month agency bills with $99/month Pro tier
AI creates, schedules, and posts to Instagram/TikTok/Facebook
Automated content based on seller's active deals and inventory

**Stream 4: AI Retention Program (included in Growth+)**
Replace $500-$1,000/month direct mail campaigns
DUM Points bring customers back automatically
Cross-merchant discovery: customer of detailer finds pizza shop
Automated point expiry reminders and deal pushes
No stamps, no printing, no mailing

**Stream 5: Buyer transaction margin**
1% on all transactions flowing through platform
Invisible to buyers — built into checkout
$100k GMV/month = $1,000/month
$500k GMV/month = $5,000/month

**Stream 6: B2B White-label (Phase 4+)**
Sell the DUM Points loyalty infrastructure to large businesses
Hotels, grocery chains, gas stations, franchise networks
They inherit our existing user network on day one
$499-$2,000+/month per enterprise client

---

## 5. DUM POINTS — THE NETWORK MOAT

Points are included in EVERY tier. This is not optional.
Points are the reason sellers stay and buyers return.

### How points work
- Buyers earn points on every purchase at any DUM Club seller
- Points are redeemable for discounts at ANY seller on network
- Sellers don't manage points — it's automatic
- Cross-merchant: earn at detailer, spend at pizza shop
- This is the loyalty network that makes switching cost high

### Current status (Phase 0)
- Points earned through purchases only
- Points NOT visible in navbar (hidden until Phase 2)
- Points purchase flow HIDDEN (pending legal review)
- /hub page exists at direct URL but not surfaced in nav
- Solana claim HIDDEN (Phase 3, needs legal sign-off)

### Phase 2 unlock conditions
- 10+ real verified sellers live on platform
- At least $1,000 in real GMV processed through Stripe
- Legal review of points purchase flow complete

### Phase 3 unlock conditions
- Points proven to drive repeat purchases (data required)
- Legal sign-off on Solana claim flow
- Solana claim remains OPTIONAL — never mandatory

### Value to sellers
1 DUM Point = $0.10 in discount value
Displayed as: "Worth $X.XX at participating merchants"
Never described as investment, token, or financial product

---

## 6. WHAT WE ARE BUILDING — PHASE MAP

### Phase 0A ✅ COMPLETE
- Demo storefronts hidden from Discover
- Ticker shows real data only
- Solana language moved to /technology page only
- DUM Points hidden from navbar
- /hub cleaned up — no Solana language in default view
- Buy Points panel hidden
- Fictional moat section (Mario's Cafe) removed
- Homepage repositioned to Morris County local services

### Phase 0B ← ACTIVE NOW
Goal: Get one real paid Stripe transaction

Tasks:
- [ ] Remove DUM Points from navbar (mobile + desktop)
- [ ] Build Topgun Maintenance LLC storefront
      (6 services, 5 photos, bio, verified=true)
- [ ] Storefront live at /project/topgun-maintenance
- [ ] Discover shows 1 verified merchant not 0
- [ ] Update homepage comparison:
      Whatnot/Commonsold/Google vs DUM Club
- [ ] Get 1 real paid Stripe transaction
- [ ] Bump FOUNDING_CAP to 100 everywhere

### Phase 1 ← LOCKED until Phase 0B complete
Goal: 100 founding sellers recruited

Tasks:
- [ ] Build Whatnot seller scraping agent
      (backend/agents/whatnot_scraper.py)
- [ ] Update 4 outreach email templates — Whatnot pitch
- [ ] Homepage redesign — Whatnot visual energy:
      - Hero: "Sell Live. Keep Everything Except a Flat Fee."
      - Founding 100 banner with real slot counter
      - Live Now grid (AWS IVS)
      - Best Deals This Week section
      - Fee comparison: Whatnot/Commonsold vs DUM Club
      - Category browse row
      - Google reviews display
- [ ] Activate AWS IVS live selling for merchants
- [ ] "Go Live" button on merchant dashboard

### Phase 2 ← LOCKED until 10+ real sellers live
Goal: DUM Points return, retention proven

Tasks:
- [ ] Restore DUM Points to navbar
- [ ] Cross-merchant loyalty active
- [ ] AI retention agent automating point reminders
- [ ] Customer retention program replaces direct mail pitch
- [ ] Points dashboard for sellers showing retention data

### Phase 3 ← LOCKED until Phase 2 proven
Goal: Optional Solana layer

Tasks:
- [ ] Legal review complete
- [ ] Optional Solana claim behind Advanced toggle
- [ ] Never mandatory, never on consumer-facing pages

### Phase 4 ← LOCKED until Phase 3 proven
Goal: Scale and monetize

Tasks:
- [ ] Flat fee tiers fully active for all new sellers
- [ ] B2B white-label points product launched
- [ ] AI social media service productized
- [ ] City-by-city replication begins
- [ ] Enterprise loyalty contracts

---

## 7. TOPGUN MAINTENANCE LLC — FOUNDING MERCHANT

Business: Topgun Maintenance LLC
Owner: Julian Mero
Email: julian@topgunmaintenance.com
Phone: +1 (201) 452-1986
Location: Morristown, NJ (MMU) — serving NY, NJ, PA, CT, DE
Slug: topgun-maintenance
Status: Founding merchant #1 — verified

Services:
1. Annual Inspection (FAR 91) — from $850
2. 100-Hour Inspection — from $650
3. Drone Inspection (Part 107) — from $350
4. AOG Emergency Response — from $500
5. Avionics Troubleshooting — $150/hr
6. Pre/Post Flight Check — from $200

Photos:
- topgunmaintenance.com/images/TG-photo-jackingplane.jpeg
- topgunmaintenance.com/images/topgunpilotinplane.jpeg
- topgunmaintenance.com/images/drone-pilots.jpeg
- topgunmaintenance.com/images/wing-inspection.jpeg
- topgunmaintenance.com/images/full-airplane-hanger.jpeg

---

## 8. TECHNICAL STACK

Frontend: Next.js — Vercel (iad1, Washington DC)
Backend: FastAPI — Railway
Database: Supabase (PostgreSQL — source of truth always)
Payments: Stripe Connect ONLY
  - No Square, no GoDaddy, no PayPal integration
  - Stripe is what Whatnot uses for payouts
  - Already fully built into codebase
Auth: Privy
Live streaming: AWS IVS (dormant — activating Phase 1)
Font: Geist (GeistSans + GeistMono)
Colors: Dark bg (#060606) + Emerald (#00FFA3)
Blockchain: Solana (future, optional, never consumer-facing)

---

## 9. KEY ROUTES

/ — Homepage (Whatnot-style, live selling focus)
/discover — Marketplace (local businesses + live sellers)
/merchant — Founding seller signup (100 slots)
/build — Business launcher
/dashboard — Merchant dashboard
/hub — DUM Points (NOT in navbar, direct URL only)
/technology — Solana/tech details (footer link only)
/admin/outreach — Email outreach admin (gated)

---

## 10. FOUNDING SELLER CONSTANTS

FOUNDING_CAP = 100
(in backend/api/routes/merchant.py — single source of truth)

Standard fee after founding: $29/month base
Commission on sales: 0% — always, for everyone, forever
Founding badge: permanent, never removed

---

## 11. COMPETITOR COMPARISON (use ONLY these)

| | Whatnot | Commonsold | Google Maps | DUM Club |
|---|---|---|---|---|
| Fee model | 8% + 2.9% | % per sale | Pay for ads | Flat $29-$99/mo |
| Loyalty | None | Basic | None | Every tier |
| AI retention | None | None | None | Built in |
| Local discovery | No | No | Pay to rank | Free + deals |
| Live selling | Yes | Yes | No | Yes |
| Social media mgmt | None | None | None | Pro tier |
| White-label loyalty | None | None | None | $499/mo+ |

Never compare to: Angi, Thumbtack, DoorDash, GrubHub,
Shopify, Base44, Lovable, Venice.ai

---

## 12. WHAT NEVER CHANGES (ABSOLUTE RULES)

1. Never charge a % of sales — flat fee only, always
2. Never fake data — no simulated tickers, no demo
   storefronts visible in Discover
3. Never show Solana/blockchain on consumer pages
4. Never show DUM Points in navbar until Phase 2
5. Never show DUM Points purchase flow until legal review
6. Never compare to Angi, Thumbtack, DoorDash
7. Never rebuild working infrastructure — surgical edits only
8. Never combine commits — one feature per commit
9. Never skip phases — earn each unlock condition
10. One real Stripe transaction before any Phase 1 work
11. Stripe is the ONLY payment processor — no exceptions
12. FOUNDING_CAP = 100 everywhere — code, docs, copy

---

## 13. REVENUE PROJECTIONS

Month 1-3 (founding 100 all free):
- Buyer 1% cut: ~$500/month
- Featured placements: ~$500/month
- AI social (5 sellers): ~$500/month
Total: ~$1,500/month

Month 4-6 (new sellers paying):
- Subscriptions (50 paying x avg $49): ~$2,450/month
- Buyer 1% cut: ~$2,000/month
- Featured placements: ~$2,000/month
- AI retention (30 sellers): ~$1,470/month
Total: ~$8,000/month

Month 7-12 (scaling):
- Subscriptions (200 paying x avg $49): ~$9,800/month
- Buyer 1% cut (on $500k GMV): ~$5,000/month
- AI social (50 sellers on Pro): ~$5,000/month
- AI retention (80 sellers): ~$3,920/month
- Featured ads (30 sellers): ~$2,970/month
Total: ~$26,000/month

Year 2 (B2B white-label unlocked):
- Marketplace revenue: ~$50,000/month
- B2B white-label (10 enterprise): ~$20,000/month
Total: ~$70,000/month = ~$840,000/year
