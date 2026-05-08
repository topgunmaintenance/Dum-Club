# CLAUDE.md v5.0 — DUM Club Master Doctrine
# Effective: April 2026
# Supersedes: All previous versions

---

## DUM CLUB EXECUTION SYSTEM

You are not brainstorming.
You are executing tasks.

If the user says:
"run task: <name>"

You MUST:

1. Load: `.claude/tasks/<name>.md`
2. Follow the execution pipeline below exactly

---

### PRE-TASK ROUTINE

- confirm current branch is NOT main
- if on main → STOP and warn
- pull latest main
- create new branch: `feature/<task-name>`
- restate task clearly
- WAIT for confirmation before coding

**Exemption for read-only tasks:** If the task file's WHAT NOT TO
DO section explicitly forbids editing code, creating files, and
committing (e.g. `scope-audit`), the branch-creation step does
not apply. Read-only tasks may run from `main`. The actual task
that follows the audit MUST still create a `feature/<task-name>`
branch per the standard routine.

---

### BUILD RULES

- build ONLY what the task says
- do NOT expand scope
- do NOT add extra features
- do NOT add fake data
- do NOT redesign unrelated UI
- reuse existing components
- use existing Tailwind + Geist
- do NOT add dependencies
- frontend only unless told otherwise

---

### SCOPE PROTECTION RULE

For every task, before editing code, you MUST:

1. Identify the minimum set of files required.
2. List those files before making changes.
3. Preserve existing working functionality unless the task
   explicitly says to replace or delete it.
4. Never add a second version of an existing section if one
   already exists.
5. Never remove code outside the named scope.
6. If a requested change conflicts with existing working
   behavior, STOP and explain the conflict before editing.
7. Prefer modifying the existing component over creating a
   duplicate.
8. After changes, report:
   - files touched
   - what was added
   - what was removed
   - why each removal was necessary

**Hard-stop phrase for task files:**

> Do not modify any code outside the named files for this task.
> If more files are needed, stop and ask first.

Every new task file should end with this phrase verbatim.

**Pre-flight workflow:**

For non-trivial changes (anything touching a page that already
has working sections), the user will run:

1. `run task: scope-audit` — Claude inspects the target
   surface, lists exactly what will be touched, flags
   duplication/deletion risk, then STOPS.
2. User reviews the audit.
3. `run task: <actual-task>` — Claude executes the actual
   work with the audit as a contract.

If the user skips the audit and goes straight to the task,
Claude should still follow the SCOPE PROTECTION RULE — but
the audit is the cleanest path.

---

### COMMIT RULE

- ONE feature = ONE commit
- clear commit message
- no mixed changes

---

### POST-TASK ROUTINE

- `git status`
- `npm run build`
- fix ONLY build errors
- do NOT improve anything else
- summarize:
  - files changed
  - what was added
  - visual description
- DO NOT push unless explicitly told

---

### HARD STOP RULE

After task is complete:
**STOP.**

Do NOT continue building anything else.

---

### TASK FILE GENERATOR

If the user says:
"create task: <name>"

You must:
- generate a new task file
- keep scope tight
- follow the build rules above
- save it to `.claude/tasks/<name>.md`

---

### TASK QUEUE SYSTEM

The queue lives at `.claude/tasks/queue.md`. It lists product tasks in
execution order. Markers: `[ ]` = not done, `[x]` = committed.

**If the user says: "run next task"**

You MUST:

1. Read `.claude/tasks/queue.md`
2. Find the first entry with a `[ ]` marker (top to bottom)
3. Load that task's file at `.claude/tasks/<name>.md`
4. Follow the PRE-TASK ROUTINE (confirm branch ≠ main, pull latest
   main, create `feature/<task-name>`)
5. Execute the task per BUILD RULES
6. Run POST-TASK ROUTINE (`git status`, `npm run build`, fix only
   build errors, summarize)
7. Commit the feature work per the COMMIT RULE. In the SAME commit,
   update `.claude/tasks/queue.md` to flip the queue item from `[ ]`
   to `[x]` and record, on the same line, the feature branch name
   and the completion date in `YYYY-MM-DD` format. Example entry:

       2. [x] search-results  — `feature/search-results` · 2026-04-15

   Do NOT attempt to embed the commit's own short SHA in the queue
   entry. A commit cannot self-reference its own hash without a
   fixed-point paradox during `git commit --amend`. Branch name +
   date is the canonical record; the commit SHA is always
   recoverable via `git log <branch>`.
8. STOP per the HARD STOP RULE. Do NOT advance to the next queue
   item automatically.

Edge cases:
- Queue empty or every item `[x]` → report "queue complete" and
  STOP without starting any work
- Next task has no matching `.claude/tasks/<name>.md` file → report
  "missing task file: <name>" and STOP without guessing at
  requirements

**If the user says: "continue"**

You MUST:
- Resume the previous task only if it ended mid-execution (incomplete
  commit, unresolved build error, explicit pause)
- Do NOT automatically advance to the next queue item
- If nothing is in progress → report "nothing to continue" and STOP

**If the user says: "stop"**

You MUST:
- Halt all execution immediately
- Do NOT commit partial work without asking first
- Report current state: branch, working tree status, last commit,
  what was in progress

---

### EXECUTION SYSTEM vs DOCTRINE

This section is the **execution contract**: how Claude should run.
Sections 1–13 below are the **product doctrine**: what DUM Club is,
what it charges, what it never does. Both are binding. If they
conflict, the doctrine wins.

---

## 1. WHO WE ARE

DUM Club is the simplest way for a local business to sell
direct and keep its own traffic. One flat monthly fee
replaces the stack of commissions and subscriptions a
local business already pays to sell online.

What we replace, in one bill:
- Delivery-app commissions (15-30% of every order)
- Live-selling commissions (8% + processing on every sale)
- Loyalty software ($50-$300/month)
- SMS / email retention tools ($20-$200/month)
- Local-deal and review platforms (pay-to-rank ad spend)

DUM Club charges a flat $29-$99/month for all of it. No
percentage cut. No per-sale fee. Ever.

The product is live selling on the merchant's own page,
loyalty (DUM Points) on every tier, AI retention on Growth+,
and local flash sales — all stitched together so the
merchant keeps their customers instead of renting them.

We are entertainment first. Commerce second.
We are the loyalty network that replaces direct mail.
We are the AI social media service replacing agencies.

We are NOT:
- Another marketplace where merchants rent traffic
- A delivery platform
- A crypto app (Solana is future, optional, legal-pending)
- An AI business launcher (deprecated — v1 positioning)
- Charging per-sale commissions ever

We ARE positioned against (in expense-replacement context):
- Delivery apps (15-30% per order vs our flat $29-$99/month)
- Whatnot (8% + 2.9% per sale vs our flat $29-$99/month)
- Commonsold (% fees + monthly vs our flat fee only)
- Loyalty software like Yotpo/Smile.io ($50-$999/month
  loyalty only vs our loyalty-included flat fee)
- SMS / email retention tools ($20-$200/month vs our
  AI retention agent included on Growth+)
- Google Maps / local-deal platforms (pay-to-rank vs our
  free display + deals)
- Direct mail agencies ($500-$2,000/month vs our $49/month
  AI retention program)

Comparisons are framed as "DUM Club replaces this expense
line," never as "DUM Club is another marketplace."

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
- Preferred founding pricing after launch (currently
  ~$29/month equivalent — number is held under
  evaluation; do NOT advertise a specific post-launch
  number publicly until the usage-tier model is decided)
- Founding seller badge permanent on their profile
- FOUNDING_CAP = 100 (constant in backend/api/routes/merchant.py)
- After slot 100: standard tiers apply to everyone new

### Canonical wording for founding-pricing copy
This wording is mandatory across all merchant-facing
surfaces. Doctrine drift toward "locked in forever" /
"lock in $29 forever" / "after the cap closes" is
deprecated; sweep on sight.

**Long form** (signup body, pricing pages, onboarding subhead):
> "Founding merchants pay $0 today and receive preferred
> founding pricing after launch. 0% commission, always."

**Short form** (founding pill, badges, captions):
> "$0 today · Preferred founding pricing · 0% commission"

**Single-line variant** (meta descriptions, OG):
> "Founding merchants get preferred pricing after launch.
> 0% commission, always."

Forbidden phrasing:
- "locked in forever" / "lock in forever"
- "$29/mo locked in forever" / "$29/month forever"
- "locked at $29/month forever after"
- "after the cap closes" / "after the founding period"
  (replace with "after launch" — clearer, less rigid)
- Hard "First 100 merchants free" energy in marketing
  copy (the founding-spots scarcity pill is real-data
  driven and stays; the loose "free" hook does not).
  The platform is maturing — copy should feel more
  credible and business-oriented.

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

**Execution status lives in `ROADMAP.md` at repo root.** That file
is the living view: current phase, % complete, per-task status,
unlock conditions, external blockers, and a recently-shipped
changelog. Update it on ship, not continuously.

This section stays as the doctrine-level phase shape. If ROADMAP.md
and this section disagree about gates/goals, CLAUDE.md is doctrine
and ROADMAP.md is stale — fix ROADMAP.md.

### Phase 0A — Strip v1 AI-builder framing
Goal: Hide DUM Points + Solana from consumer pages. Reposition
homepage away from "type an idea → AI builds a business".
Gate out: none (starting point).

### Phase 0B — First real paid Stripe transaction
Goal: One real checkout against Topgun Maintenance's storefront.
Gate out: a single row in `orders` with `status='paid'` and
amount > 0 coming from production-mode Stripe.

### Phase 1 — 100 founding sellers recruited
Goal: Hit the founding cap via Whatnot seller outreach.
Gate out: 100 rows in `merchants` table with
`stripe_connect_status='connected'`.

### Phase 2 — DUM Points return, retention proven
Goal: Points back in navbar, cross-merchant loyalty active,
AI retention agent replacing direct mail.
Gate out: 10+ verified sellers live AND $1,000+ real GMV AND
legal review of points purchase flow complete.

### Phase 3 — Optional Solana layer
Goal: Solana claim available as an opt-in toggle only.
Gate out: Phase 2 proven with data AND legal sign-off on the
Solana claim flow.

### Phase 4 — Scale and monetize
Goal: Flat-fee tiers fully active, B2B white-label product,
AI social media productized, city-by-city replication, enterprise
loyalty contracts.
Gate out: Year-1 revenue projection from Section 13 achieved.

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
  - Connect account type: Express (via OAuth) — Stripe-managed
    onboarding, merchant gets their own dashboard, identity review
    handled by Stripe. Charge model: Direct charges — session is
    created inside the merchant's connected account via the
    `stripe_account` request option; platform takes its cut via
    `application_fee_amount` on the PaymentIntent.
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

The framing is **expense replacement**, not "another
marketplace." DUM Club replaces a stack of separate
monthly bills with one flat fee. Surface comparisons in
that context, not as feature-by-feature competitor
takedowns.

### Expense lines DUM Club replaces

| Expense line | What businesses pay today | DUM Club |
|---|---|---|
| Delivery-app commissions | 15-30% of every order | Flat $29-$99/mo |
| Live-selling commissions (Whatnot) | 8% + 2.9% per sale | Flat $29-$99/mo |
| Live-selling commissions (Commonsold) | % per sale + monthly | Flat $29-$99/mo |
| Loyalty software (Yotpo, Smile.io) | $50-$999/mo | Included every tier |
| SMS / email retention | $20-$200/mo | Included Growth+ |
| Local-deal / review platforms | $500-$2,000/mo ad spend | Free display + deals |
| AI social media agency | $500-$2,000/mo | Included Pro |

### Capability matrix (when a side-by-side is genuinely useful)

| | Live-selling competitors | Loyalty / retention SaaS | Delivery apps | DUM Club |
|---|---|---|---|---|
| Fee model | % per sale | Monthly per tool | % per order | Flat $29-$99/mo |
| Loyalty | None / basic | Their only product | None | Every tier |
| AI retention | None | Add-on | None | Growth+ |
| Local discovery | No | No | Listing only | Free + deals |
| Live selling | Yes | No | No | Yes |
| Social media mgmt | None | None | None | Pro tier |
| White-label loyalty | None | Enterprise only | None | $499/mo+ |

Comparisons against delivery apps (DoorDash / Uber Eats /
GrubHub) are allowed **only** in expense-replacement
context — citing 15-30% commission as a line a local
business already pays. Never frame DUM Club as a delivery
service or as competing with logistics. Never compare to
Angi, Thumbtack, Shopify, Base44, Lovable, or Venice.ai —
those are different categories that confuse the pitch.

---

## 12. WHAT NEVER CHANGES (ABSOLUTE RULES)

1. Never charge a % of sales — flat fee only, always
2. Never fake data — no simulated tickers, no demo
   storefronts visible in Discover
3. Never show Solana/blockchain on consumer pages
4. Never show DUM Points in navbar until Phase 2
5. Never show DUM Points purchase flow until legal review
6. Never compare to Angi, Thumbtack, Shopify (delivery-app
   commissions are allowed only in expense-replacement
   framing — never as a logistics competitor)
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
