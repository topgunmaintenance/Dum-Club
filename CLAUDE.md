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

### ARMING THE SCOPE FENCE

This project has a mechanical scope fence (`.claude/scope-gate.py`, run as a PreToolUse hook) that blocks edits to any file not listed in `.claude/task-scope.txt`.

At the START of every task that changes code:
1. Identify the minimum set of files required (per SCOPE PROTECTION RULE above).
2. Write those paths into `.claude/task-scope.txt`, one path or glob per line, replacing the disarming `*`. This arms the fence.
3. If a file outside the list turns out to be needed mid-task: STOP, explain to Julian why, and wait for approval before adding it. Never silently expand scope.
4. When the task is done, restore `.claude/task-scope.txt` to a single line `*` to disarm.

See `.claude/tasks/scope-template.md` for the copy-paste format.

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
Sections 1-13 below are the **product doctrine**: what DUM Club is,
what it charges, what it never does. Both are binding. If they
conflict, the doctrine wins.

---

### HUMAN COPY GUARD

Customer-facing copy on DUM Club must read like a founder talking
to a local shop owner. Direct, practical, simple. Never robotic
SaaS / AI marketing language.

Banned phrases and patterns are enforced by:

    npm run check:human-copy

This script (`scripts/check-human-copy.mjs`) scans every public-
facing page, layout, and shared component for:

- em dashes (`—`) and en dashes (`–`) in user-visible strings
- repeated dash separators (three or more " - " chunks on one line)
- banned SaaS / AI marketing words: seamlessly, cutting-edge,
  comprehensive, optimize, empower, elevate, robust, leverage,
  frictionless, industry-leading, world-class, revolutionary,
  game-changing, streamline, next-generation, state-of-the-art,
  best-in-class, and "unlock" inside display copy
- specific phrases the founder explicitly does not want shipped,
  including "AI retention agent", "cross-merchant discovery",
  "technical layer", "canonical state", and "source of truth"

Approved compound terms (allowed): real-time, first-time,
mobile-first, pop-in, AI-powered, FAA-certified, time-sensitive,
in-app, follow-up, same-day, off-peak, mid-size.

Approved phrase replacements:

- "AI retention agent"        -> "automatic customer win-back texts"
- "cross-merchant discovery"  -> "customers can find nearby deals"
- "technical layer"           -> "the system behind DUM Club"
- "canonical state / source of truth" -> plain developer wording or
                                  "where the data lives"

Run `npm run check:human-copy` before every PR. It exits non-zero
when a violation is found and refuses to ship robotic copy.

Out of scope for the guard: admin tooling (/admin/*), API routes
(/api/*), the /_dev preview surface, tests, and code comments.
Those are developer-facing and may contain dashes.

---

## 1. WHO WE ARE

DUM Club is the simplest way for a local business to sell
direct and keep its own traffic. One flat monthly fee
replaces the stack of commissions and subscriptions a
local business already pays to sell online.

What we replace, in one bill:
- Delivery-app commissions (15-30% of every order)
- Live-selling commissions (up to 8% + processing on every sale)
- Loyalty software ($50-$300/month)
- SMS / email retention tools ($20-$200/month)
- Local-deal and review platforms (pay-to-rank ad spend)

DUM Club charges a flat $39-$2,000+/month subscription plus
a 1.5% sales fee — industry-low (vs Whatnot up to 8%, DoorDash 15-30%,
CommentSold 2-3% plus subscription). The combined model
includes tier-based viewer-hour limits, overage above the
included viewer-hours, and the 1.5% sales fee on every paid
order. Stripe processing (2.9% + $0.30) is paid by the buyer
at checkout, not by the seller.

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
- Taking Whatnot-scale percentages (we charge 1.5%; Whatnot
  charges up to 8%; DoorDash charges 15-30%)

We ARE positioned against (in expense-replacement context):
- Delivery apps (15-30% per order vs our subscription
  $39-$299/month + 1.5% sales fee)
- Whatnot (up to 8% + 2.9% per sale vs our subscription
  $39-$299/month + 1.5% sales fee)
- Commonsold (2-3% + $499-$1,499/month vs our subscription
  $39-$299/month + 1.5% sales fee)
- Loyalty software like Yotpo/Smile.io ($50-$999/month
  loyalty only vs our loyalty-included subscription)
- SMS / email retention tools ($20-$200/month vs our
  AI retention agent included on Growth+)
- Google Maps / local-deal platforms (pay-to-rank vs our
  free display + deals)
- Direct mail agencies ($500-$2,000/month vs our $99/month
  Growth-tier AI retention program)

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
- $0 subscription during 60-day founding trial period
- After trial: locks in founding-tier subscription pricing
  for life (Starter base = $39/month). The 1.5% sales fee
  and overage rules apply to all merchants including
  founders — founding lock is on the subscription tier,
  not on the sales-fee or overage lines.
- Founding seller badge permanent on their profile
- FOUNDING_CAP = 100 (constant in backend/api/routes/merchant.py)
- After slot 100: standard tiers apply to everyone new

### Canonical wording for founding-pricing copy
This wording is mandatory across all merchant-facing
surfaces. Founder doctrine update May 2026: founding offer
language now explicitly commits to lifelong founding-tier
pricing for the first 100 merchants. The prior "preferred
founding pricing after launch" wording was vague about what
the merchant actually pays after the trial; the new line ties
the founding tier to the merchant for the life of the
account.

**Long form** (signup body, pricing pages, onboarding subhead):
> "Join the first 100 merchants. Get 60 days free and lock
> in founding pricing for life."

**Supporting line** (always pairs with the long form):
> "Flat monthly subscription + 1.5% sales fee. Industry-low
> (Whatnot takes up to 8%). Keep more of every sale."

**Short form / scarcity pill / banner**:
> "60 days free · Lock in founding pricing for life"

**CTA button labels (pick the one that fits the surface)**:
- "Claim Your Founding Spot"
- "Start Free for 60 Days"
- "Lock In Founding Pricing"

Forbidden phrasing (sweep on sight):
- "free forever" / "$0 forever" — implies the platform is
  free; contradicts the trial → paid flow
- "$29/mo locked in forever" / "$29/month forever" — never
  quote a specific dollar amount as locked; the founding tier
  number can change in the future even though the locked-in
  promise to founding merchants stands
- "preferred founding pricing" / "preferred founding pricing
  after launch" — replaced; vague about what the merchant pays
- "$0 today" / "$0 during the founding period" / "during the
  founding period" — replaced by "60 days free"
- Hard "First 100 merchants get in free" / "first 100 free"
  energy outside of the canonical phrasing above
- "X of 100 founding spots claimed" / "<N> of 100" / any live
  merchant-count display — we do NOT surface live traction
  metrics to public visitors or competitors during the
  founding ramp. The /api/merchant/founding-status endpoint
  returns only `founding_program_open` (boolean) as of the
  PR that locked it down; do not re-add `slots_remaining` /
  `total_cap` to the public response or to any visitor-facing
  UI. Internal admin dashboards may surface the count by
  querying merchants directly via service-role Supabase.
- DUM Points framed as investments / tradable assets / yield-
  bearing instruments

Scarcity / urgency is now carried by static copy ("Limited ·
Founding 100" eyebrow, "Join the first 100 merchants" H2,
"60 days free · Lock in founding pricing for life" pill copy)
— never by a live counter.

### Standard Tiers (seller 101+)

Every tier includes a monthly subscription, an included
viewer-hour budget (concurrent viewers × time watched),
an overage rate billed per viewer-hour above the included
amount, a concurrent-viewer ceiling, and a max-concurrent-
streams cap. Every tier also pays a flat 1.5% sales fee on
every paid order. See `backend/db/migrations/049_plan_limits.sql`
for the seed values — that table is the source of truth.

**Starter — $39/month**
- 250 included viewer-hours/month
- 250 concurrent viewer ceiling, 1 concurrent stream max
- $0.13/viewer-hour overage above the included 250
- 1.5% sales fee on all paid orders
- Storefront on DUM Club marketplace
- DUM Points built in automatically
- Basic sales analytics
- Stripe direct payouts
- Listed on Discover page

**Growth — $99/month**
- 700 included viewer-hours/month
- 600 concurrent viewer ceiling, 1 concurrent stream max
- $0.12/viewer-hour overage above the included 700
- 1.5% sales fee on all paid orders
- Everything in Starter
- Featured placement in category browse
- Automatic customer win-back texts (replaces direct mail)
- Google review display on storefront
- Best Deals This Week eligibility

**Pro — $299/month**
- 1,500 included viewer-hours/month
- 2,000 concurrent viewer ceiling, 3 concurrent streams max
- $0.10/viewer-hour overage above the included 1,500
- 1.5% sales fee on all paid orders
- Everything in Growth
- AI social media management
  (Instagram/TikTok/Facebook automated posting)
- Homepage featured slot
- Cross-business deal promotions
- Full analytics dashboard
- Priority placement in search

**Business — $499/month (white-label)**
- Custom viewer-hour budget, concurrent ceiling, and
  max-streams negotiated per contract
- $0.10/viewer-hour overage above the contracted budget
- 1.5% sales fee on all paid orders
- DUM Points under YOUR brand name
- Custom rewards rules and earning rates
- API access for your own platform
- Dedicated AI retention agent
- For mid-size businesses wanting their own loyalty program
  without building infrastructure

**Enterprise — $2,000+/month**
- Custom viewer-hour budget, concurrent ceiling, and
  max-streams negotiated per contract
- $0.08/viewer-hour overage above the contracted budget
- 1.5% sales fee on all paid orders (subject to contract
  negotiation on enterprise deals)
- Full white-label loyalty infrastructure
- Custom integrations (POS, CRM, ERP)
- Multi-location support
- Dedicated account manager
- For hotel chains, retail chains, franchise networks

### No-double-bill rule (applies to all tiers)
At billing-period close, if the merchant's 1.5% sales fee
earnings already cover their viewer-hour overage, the
overage is waived (or netted against the sales fee). The
merchant only pays for video if their sales didn't already
cover the cost. Formula:
  net_overage_billed = max(0, overage_owed - sales_fee_earned)
This applies uniformly across all five tiers.

### Never
- Never charge more than 1.5% on sales (1.5% is the cap;
  doctrine forbids exceeding it)
- Never charge per-transaction extras to sellers above the
  flat 1.5% sales fee
- Never charge listing fees
- Never advertise a tier without disclosing the viewer-hour
  budget, overage rate, and 1.5% sales fee
- Stripe processing fees (2.9% + $0.30) are paid by
  the buyer as part of checkout — not by the seller

---

## 4. REVENUE STREAMS

**Stream 1: Flat monthly subscriptions**
$39-$2,000+/month per seller depending on tier
Predictable, recurring, scales with seller count

**Stream 2: On-site advertising**
- Featured placement in Best Deals This Week: $99/month
- Category sponsorship: $49/month per category
- Homepage banner: $199/month
- Sold to merchants already on the platform

**Stream 3: AI Social Media Service (included in Pro)**
Replace $500-$2,000/month agency bills with $299/month
Pro tier. AI creates, schedules, and posts to Instagram/
TikTok/Facebook based on seller's active deals and inventory.

**Stream 4: AI Retention Program (included in Growth+)**
Replace $500-$1,000/month direct mail campaigns
DUM Points bring customers back automatically
Customers can find nearby deals across the merchant network
Automated point expiry reminders and deal pushes
No stamps, no printing, no mailing

**Stream 5: 1.5% sales fee on all paid orders**
Deducted from seller payout via Stripe application_fee_amount
on every PaymentIntent. Reads commission_rate from plan_limits
(1.50% on every tier after migration 082); merchant-specific
overrides via merchants.commission_rate_override (currently
unused — left untouched by 054).
At $100k merchant GMV/month: ~$1,000/month per merchant.
At $500k merchant GMV/month: ~$5,000/month per merchant.
No-double-bill: at billing-period close, this stream is netted
against viewer-hour overage owed (see §3 No-double-bill rule).
So this stream's realized revenue is reduced for merchants
whose overage was waived by the rule — the trade-off was made
deliberately for retention.

**Stream 6: Viewer-hour overage**
$0.13/$0.12/$0.10/$0.10/$0.08 per viewer-hour above the
included budget (Starter/Growth/Pro/Business/Enterprise).
Variable revenue: scales with merchant viewer counts, not
sales. After no-double-bill netting against Stream 5, this is
realized only when overage > sales-fee earnings.

**Stream 7: B2B White-label (Phase 4+)**
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
Font: Geist (GeistSans for UI, GeistMono for prices/counts/timers)
Colors: LIGHT theme is what ships (the old "dark #060606 +
  #00FFA3" line was stale — do not drift back to dark). Tokens
  live in frontend/app/globals.css + frontend/tailwind.config.js:
  - Surfaces: --surface-page #F7F8FA (page),
    --surface-card #FFFFFF (cards, hairline border + soft shadow),
    --surface-muted #EEF1F5
  - Text: --text-primary #0B1220, --text-secondary #475467,
    --text-muted #6B7280
  - Brand mint, TWO values (legibility split — bright mint is
    illegible as text on white):
      --mint-fill #00E592  button FILLS only (Follow, BUY, active
        tab), always paired with --mint-fill-ink #04130D text
      --mint-text #00A36C  mint used as TEXT / icons / prices on
        white
  - Coral --state-live #FF2D55: live status + urgency ONLY (LIVE
    badges, the pulsing live dot, low-stock "N left"). Never an
    action color, never decorative — that's mint's job.
  Legacy --brand-teal #14B89A / --brand-navy still exist for
  non-buyer chrome (dashboard/admin); buyer surfaces (Discover,
  Clubs, Follow, the live room) use the mint split + coral above.
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

Standard subscription after founding: $39/month base (Starter tier)
Sales fee on all sales: 1.5% — applied via Stripe
application_fee_amount on every PaymentIntent. Source of
truth: plan_limits.commission_rate (1.50% on every tier after
migration 082). 1.5% applies to all merchants including
founders; founding-tier lock covers the subscription price,
not the sales fee.
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
| Delivery-app commissions | 15-30% of every order | $39-$299/mo + 1.5% sales fee |
| Live-selling commissions (Whatnot) | up to 8% + 2.9% per sale | $39-$299/mo + 1.5% sales fee |
| Live-selling commissions (Commonsold) | 2-3% per sale + $499-$1,499/mo | $39-$299/mo + 1.5% sales fee |
| Loyalty software (Yotpo, Smile.io) | $50-$999/mo | Included every tier |
| SMS / email retention | $20-$200/mo | Included Growth+ |
| Local-deal / review platforms | $500-$2,000/mo ad spend | Free display + deals |
| AI social media agency | $500-$2,000/mo | Included Pro |

### Capability matrix (when a side-by-side is genuinely useful)

| | Live-selling competitors | Loyalty / retention SaaS | Delivery apps | DUM Club |
|---|---|---|---|---|
| Fee model | up to 8% + processing per sale | Monthly per tool | 15-30% per order | $39-$2,000+/mo + 1.5% sales fee |
| Loyalty | None / basic | Their only product | None | Every tier |
| AI retention | None | Add-on | None | Growth+ |
| Local discovery | No | No | Listing only | Free + deals |
| Live selling | Yes | No | No | Yes |
| Social media mgmt | None | None | None | Pro tier |
| White-label loyalty | None | Enterprise only | None | $499/mo+ |
| Viewer-hour budget + overage | n/a | n/a | n/a | Per tier; see §3 |
| No-double-bill rule | n/a | n/a | n/a | Yes; see §3 |

Comparisons against delivery apps (DoorDash / Uber Eats /
GrubHub) are allowed **only** in expense-replacement
context — citing 15-30% commission as a line a local
business already pays. Never frame DUM Club as a delivery
service or as competing with logistics. Never compare to
Angi, Thumbtack, Shopify, Base44, Lovable, or Venice.ai —
those are different categories that confuse the pitch.

---

## 12. WHAT NEVER CHANGES (ABSOLUTE RULES)

1. 1.5% sales fee on every paid order; flat subscription
   tier; never charge more than 1.5% to sellers. The 1.5% cap
   is doctrine — exceeding it requires a doctrine update,
   not a billing-config change.
2. Never fake data — no simulated tickers, no demo
   storefronts visible in Discover.
   **Explicit exception — homepage Live Now empty state (bridge
   measure, Phase 0/1 only):** when zero real businesses are
   currently live, the homepage's Live Now slot may show a grid
   of example-shop tiles (the DemoStoreRail, styled after the
   June 2026 handoff's tile design) so a first-time visitor sees
   what live local commerce looks like instead of a blank page.
   Founder decision 2026-07-01 ("fake it till you make it"):
   this supersedes the earlier one-tile-only ruling from the
   June 2026 handoff review — a full example grid is approved.
   The honesty rules are unchanged and non-negotiable. Every
   example tile must:
     - Never say "LIVE" or use the coral live-status color/dot —
       those are reserved for real broadcasts only. Tiles carry
       an "EXAMPLE" badge instead.
     - Never show a viewer count or any other fabricated live
       metric, and the rail's header must say these are example
       shops — never framed as actual sellers.
     - Disappear automatically as real businesses go live — this
       is a data-driven fallback (renders only when the real
       live-projects list is empty), not a manual toggle, so it
       self-removes without needing a follow-up change.
     - Link to the homepage's #demo section (the interactive
       "Watch a shop go live" demo) so a visitor tapping an
       example shop sees live shopping in action. Founder
       decision 2026-07-06; supersedes the original
       link-to-/merchant ruling. The demo section's own CTA
       carries the conversion to /merchant, and the rail's
       "Yours could be here" line still links /merchant
       directly.
   This exception does not extend to Discover, the businesses
   grid, or any other surface — those stay real-data-only, no
   exceptions. Simulated activity tickers and fictional customer
   testimonials remain banned everywhere.
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

**Re-derivation pending.** The projections below were
calculated against the pre-2026-05 pricing ($29/$49/$99 +
0% commission). The 1% sales fee model + viewer-hour
overage replaces the "Buyer 1% cut" line previously
shown here. The "Subscriptions x avg $49" assumption
should be re-derived against the new tier mix
(Starter $39 / Growth $99 / Pro $299) once the post-
launch tier distribution data is available. Until then,
these numbers are illustrative-only.

Month 1-3 (founding 100 all on 60-day trial):
- 1% sales fee on founding GMV (~$50k): ~$500/month
- Featured placements: ~$500/month
- AI social (5 sellers): ~$500/month
Total: ~$1,500/month

Month 4-6 (new sellers paying, mixed-tier):
- Subscriptions (50 paying x avg $99 — Growth-weighted): ~$4,950/month
- 1% sales fee (on ~$200k aggregate GMV): ~$2,000/month
- Featured placements: ~$2,000/month
- AI retention (30 sellers): ~$1,470/month
Total: ~$10,400/month

Month 7-12 (scaling, mixed-tier):
- Subscriptions (200 paying x avg $99 — Growth-weighted): ~$19,800/month
- 1% sales fee (on ~$500k aggregate GMV): ~$5,000/month
- Viewer-hour overage (post-no-double-bill netting): variable
- AI social (50 sellers on Pro at $299): ~$15,000/month
- AI retention (80 sellers): ~$3,920/month
- Featured ads (30 sellers): ~$2,970/month
Total: ~$46,700/month

Year 2 (B2B white-label unlocked):
- Marketplace revenue: ~$50,000/month
- B2B white-label (10 enterprise): ~$20,000/month
Total: ~$70,000/month = ~$840,000/year
