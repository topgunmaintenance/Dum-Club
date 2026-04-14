# DUM Club — Master Engineering & Business Directive
# Version: 4.1 FINAL
# Save as: CLAUDE.md in project root
# This is the single source of truth for everything
# Claude Code reads this automatically every session
# Nothing overrides this file

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 1 — WHAT WE ARE BUILDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DUM Club is a universal commerce, loyalty, and
customer retention platform built for real
neighborhoods and local businesses.

The simplest description:
"Visa meets Starbucks Rewards meets Shopify meets
Whatnot — but local, affordable, and rewarding
for every person in the transaction."

We are NOT a delivery platform.
We are NOT competing with DoorDash or GrubHub.
We are in the customer relationship business.

Four products in one platform:

1. LIVE COMMERCE
   Sellers stream and sell items live
   Buyers pay via Stripe
   Everyone earns DUM Points automatically
   Model: Whatnot competitor
   Status: Built — UX polish complete Sprint 1

2. LIVE FOOD SHOWCASE
   Restaurant owner goes live to show
   today's specials being prepared
   Customers watch, get hungry, come in
   or order pickup through the app
   DUM Points earned on every visit
   and pickup order
   No drivers, no delivery, no logistics
   Status: To be built Sprint 5

3. UNIVERSAL LOYALTY NETWORK
   Any business connects their existing POS
   Customers earn DUM Points on every purchase
   Points work across ALL merchants on network
   No new POS hardware ever required
   Model: Starbucks Rewards for every
   local business not just one chain
   Status: Sprint 2 in progress

4. PICKUP ORDERING
   Customer browses merchant menu on DUM Club
   Places order for pickup
   Pays via Stripe at order time
   Earns DUM Points on every pickup order
   Restaurant receives order immediately
   Customer picks up in person
   No drivers, no delivery, no logistics
   Status: To be built Sprint 4

5. MERCHANT SUBSCRIPTIONS
   Flat monthly fee — no per-order commission
   Businesses keep their Square/Toast/Clover
   Get loyalty infrastructure instantly
   Founding merchants pay $0/month
   Status: Sprint 2 in progress

6. SMART RESTAURANT GREETER (hardware add-on)
   Raspberry Pi device at restaurant entrance
   Greets customers by voice in 7 languages
   Replaces manual foot traffic clicker
   Shows specials and DUM Points QR code
   Status: Demo built, API not yet wired
   Deploy after 20 merchants live

Core value per audience:

  For customers:
  "Earn points everywhere. Redeem anywhere.
   Never lose a reward again."

  For small businesses:
  "We bring customers to your door and keep
   them coming back forever. $29/month flat.
   No commission. No new hardware."

  For sellers:
  "Go live and sell in 10 seconds.
   Your buyers earn rewards automatically."

The flywheel:
  Customer watches live show
  → earns DUM Points
  → visits local restaurant
  → earns more DUM Points
  → points bring them back
  → merchant sees ROI
  → merchant tells neighbors
  → network grows
  → points work at more places
  → customers discover more merchants

That cross-merchant loyalty is the moat.
Whatnot cannot build it.
DoorDash cannot build it.
Square cannot build it.
Starbucks cannot do it for other businesses.
We can.

One sentence:
"DUM Club turns every real-world transaction
into rewards and keeps customers coming back
to every business on the network."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 2 — COMPETITIVE POSITION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

We compete with:
  Whatnot — live commerce
  Toast/Square loyalty add-ons
  Yotpo/LoyaltyLion/Smile.io — loyalty SaaS
  PetSmart Treats/Starbucks Rewards — enterprise
  Manual door clickers — foot traffic counting

We do NOT compete with:
  DoorDash — we do not deliver food
  GrubHub — we do not deliver food
  Uber Eats — we do not deliver food
  Crypto projects — we are not a token platform
  Web3 apps — we are not blockchain-first

Our advantages:

vs Whatnot:
  Same live commerce experience
  Plus DUM Points on every purchase
  Points bring buyers back between shows
  Cross-merchant network they cannot build

vs Square/Toast loyalty add-ons:
  They charge $49-100/month extra for loyalty
  We charge $29/month total all-in
  We work WITH their existing system
  No new hardware ever

vs DoorDash (indirect):
  We do not fight them on delivery
  We take their restaurant relationships
  by giving merchants what DoorDash never did:
  their own customer data back
  without paying 15-30% per order forever

Market timing:
  Starbucks rewards overhaul March 2026
  Customers calling it punishing
  Restaurants bleeding 15-30% to DoorDash
  Every participant has a reason to switch

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 3 — EXISTING TECH STACK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Frontend:        Next.js on Vercel
Backend:         FastAPI on Railway
Database:        Supabase / PostgreSQL
Payments:        Stripe + Stripe Connect
Auth:            Privy (not Supabase auth)
                 User identifier: owner_privy_id TEXT
                 Never UUID references to auth.users
Live Streaming:  AWS IVS real-time
Solana Program:  FYgLqjJ7RHmT46xb5EiNGNa8XFbckqPWkEVLt2ztjnLV
Network:         Solana devnet, mainnet after legal review
Hardware:        Raspberry Pi Zero 2W (greeter device)
Voice:           Web Speech API (free, built-in)

CRITICAL AUTH RULE:
  Auth uses Privy IDs throughout
  All user references: owner_privy_id TEXT
  Never UUID references to auth.users
  Matches existing tables: business_profiles
  and all user-linked tables in this codebase

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 4 — FEATURE FLAGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Existing flags in feature_flags.py
(never remove or rename these):
  external_local_search_enabled
  off_platform_receipt_rewards_enabled
  merchant_outreach_queue_enabled
  merchant_outreach_send_enabled
  local_discovery_agent_enabled
  purchase_proof_agent_enabled
  purchase_proof_auto_verify_enabled
  rewards_agent_enabled

New flags to add (separate commit after docs):
  ENABLE_SOLANA=true
  ENABLE_AUTO_MINT=false
  ENABLE_CLAIM_UI=true
  ENABLE_TOKEN_UI=false
  ENABLE_POS_WEBHOOKS=false
  ENABLE_LIVE_COMMERCE=true
  ENABLE_MERCHANT_PORTAL=false
  ENABLE_PICKUP_ORDERING=false
  ENABLE_LIVE_FOOD_SHOWCASE=false
  ENABLE_GREETER_DEVICE=false
  ENABLE_FOOT_TRAFFIC=false

Rules:
  Never hardcode flags — read from environment
  Feature flags are additive — never remove existing
  New flags default to false until enabled

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 5 — CORE PHILOSOPHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1.  Database is ALWAYS source of truth
    Solana mirrors it — never the master

2.  Never block transaction on blockchain op
    All Solana work is async, background, queued

3.  Never show blockchain errors during any flow
    Friendly errors only on user-initiated claim

4.  Users never touch crypto unless they choose to
    Wallet connection only after real engagement

5.  DUM = DUM Points in all user-facing language
    Never: token, crypto, investment, value growth

6.  Stripe handles DUM Club platform transactions
    Square/Toast/Clover handle merchant POS
    We only read their webhooks — never touch money

7.  We never build our own POS system
    We integrate WITH existing POS via webhooks

8.  We are NOT a delivery platform
    No drivers, no logistics, no cold food
    We bring customers to merchants

9.  Every engineering decision answers one question:
    Does this help get more transactions on platform?
    Yes → build it. No → park it.

10. Feature leads with crypto → pause
    Feature leads with commerce → build it

11. Greeter device is a sales tool first
    Do not productize until 20+ merchants live

12. Auth is Privy throughout
    All user references use owner_privy_id TEXT
    Never UUID references to auth.users

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 6 — TRANSACTION TYPES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TYPE 1: LIVE COMMERCE (Stripe processes)
  Customer buys during live stream
  Platform fee: currently 7% hardcoded
  Do not change until explicitly instructed
  DUM Points awarded to buyer

TYPE 2: POS WEBHOOK (Stripe NOT involved)
  Customer buys at merchant via Square etc
  POS fires webhook — we read data only
  We award DUM Points by email match
  Revenue: covered by merchant subscription

TYPE 3: MERCHANT SUBSCRIPTION (Stripe Billing)
  Founding merchants: $0/month
  Future merchants: $29/month
  Pure recurring revenue

TYPE 4: PICKUP ORDER (Stripe processes)
  Customer orders pickup on DUM Club
  Stripe charges at order time
  Merchant notified, customer picks up
  DUM Points awarded on completion
  Status: Not yet built — Sprint 4

TYPE 5: FOOT TRAFFIC EVENT (no payment)
  PIR sensor logs entry
  Sent to DUM Club API in batches
  Replaces manual door clicker
  Status: Demo built, API not wired

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 7 — MERCHANT TIERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOUNDING MERCHANT PROGRAM:
  First 50 merchants: $0/month, $0 platform fee
  founding_merchant = true in database
  founding_slot_number assigned 1..50 on signup
  plan_type = 'founding' while slots remain
  Full access to all features
  Grandfathered when paid tiers launch
  Launch pitch: "Let me help you make money first"

LOCAL — $29/month (after founding period)
  Unlimited transactions
  DUM Points issued automatically
  POS integration (Square, Toast, Clover)
  Single location, QR code, email support

LOCAL+ — $49/month
  Everything in Local
  Listed on DUM Club for pickup ordering
  Optional: DUM Greeter hardware add-on

REGIONAL — $99/month
  Multi-location up to 3
  Custom DUM reward rate
  DUM Greeter included (1 unit)

ENTERPRISE — $299/month
  Unlimited everything
  White-label, API access
  DUM Greeter per location

RULES:
  All tiers USD only — no crypto required
  No DUM staking for tier access ever
  founding_merchant flag overrides all pricing
  Do not hard-code $29 anywhere in UI
  Pricing must support $0 intro period

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 8 — POS INTEGRATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

We NEVER build our own POS system.
We plug INTO existing POS via webhook APIs.
Merchant keeps everything. We add loyalty on top.

BUILD PRIORITY:
  1. Square (largest small business base)
  2. Toast (dominates NJ/NY restaurants)
  3. Clover (retail and quick service)
  4. Manual webhook (enterprise)

SQUARE INTEGRATION:
  Merchant connects via OAuth — one click
  We receive their location_id
  Every Square sale auto-triggers webhook
  Match location_id to DUM Club merchant
  Match buyer email to DUM Club user
  Award DUM Points atomically

CUSTOMER IDENTITY MATCHING:
  Primary: email matching (automatic)
  Secondary: QR code scan (one time setup)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 9 — DATABASE SCHEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL AUTH NOTE:
  All user references: owner_privy_id TEXT
  Never UUID REFERENCES auth.users(id)
  Matches existing codebase pattern throughout

MERCHANTS TABLE (migration approved):
CREATE TABLE IF NOT EXISTS merchants (
  id                      UUID PRIMARY KEY
                          DEFAULT gen_random_uuid(),
  owner_privy_id          TEXT NOT NULL UNIQUE,
  business_profile_id     UUID REFERENCES
                          business_profiles(id),
  founding_merchant       BOOLEAN NOT NULL DEFAULT true,
  subscription_tier       VARCHAR NOT NULL
                          DEFAULT 'founding',
  subscription_price_usd  DECIMAL(10,2) NOT NULL
                          DEFAULT 0,
  platform_fee_percent    DECIMAL(5,2) NOT NULL
                          DEFAULT 0,
  stripe_connect_id       VARCHAR,
  stripe_connect_status   VARCHAR NOT NULL
                          DEFAULT 'not_connected',
  square_location_id      VARCHAR,
  square_access_token_enc VARCHAR,
  square_status           VARCHAR NOT NULL
                          DEFAULT 'not_connected',
  business_name           VARCHAR NOT NULL,
  business_type           VARCHAR,
  location_city           VARCHAR,
  location_state          VARCHAR,
  notes                   TEXT,
  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL
                          DEFAULT NOW()
);

CREATE INDEX idx_merchants_owner
  ON merchants(owner_privy_id);
CREATE INDEX idx_merchants_stripe
  ON merchants(stripe_connect_id)
  WHERE stripe_connect_id IS NOT NULL;
CREATE INDEX idx_merchants_square
  ON merchants(square_location_id)
  WHERE square_location_id IS NOT NULL;

DUM BALANCES:
CREATE TABLE dum_balances (
  owner_privy_id      TEXT PRIMARY KEY,
  off_chain_balance   DECIMAL DEFAULT 0,
  pending_mint        DECIMAL DEFAULT 0,
  on_chain_balance    DECIMAL DEFAULT 0,
  wallet_address      VARCHAR,
  updated_at          TIMESTAMP DEFAULT NOW()
);

DUM TRANSACTIONS:
CREATE TABLE dum_transactions (
  id                  UUID PRIMARY KEY
                      DEFAULT gen_random_uuid(),
  owner_privy_id      TEXT NOT NULL,
  merchant_id         UUID REFERENCES merchants(id),
  type                VARCHAR NOT NULL,
  amount              DECIMAL NOT NULL,
  stripe_payment_id   VARCHAR,
  stripe_transfer_id  VARCHAR,
  pos_transaction_id  VARCHAR,
  pos_provider        VARCHAR,
  solana_tx_signature VARCHAR,
  created_at          TIMESTAMP DEFAULT NOW()
);

MINT QUEUE:
CREATE TABLE mint_queue (
  id             UUID PRIMARY KEY
                 DEFAULT gen_random_uuid(),
  owner_privy_id TEXT NOT NULL,
  amount         DECIMAL NOT NULL,
  status         VARCHAR DEFAULT 'pending',
  attempts       INT DEFAULT 0,
  error_log      TEXT,
  created_at     TIMESTAMP DEFAULT NOW(),
  processed_at   TIMESTAMP
);

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 10 — PAYMENT AND REWARDS FLOWS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STRIPE WEBHOOK:
  Already hardened — commit ec3a81c
  Do not rebuild without explicit instruction
  Idempotency via processed_webhook_events table

DUM REWARD RATE:
  DUM_REWARD_RATE=10 env var — never hardcode
  dum_earned = (amount_cents / 100) * rate
  Merchant custom rate overrides global

ATOMIC BALANCE RULE:
  Always SQL increment — never read-modify-write
  UPDATE dum_balances
  SET off_chain_balance = off_chain_balance + :amt
  WHERE owner_privy_id = :privy_id

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 11 — API ENDPOINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EXISTING (do not modify without instruction):
  POST /api/checkout/webhook
  POST /api/ivs/create-stage
  POST /api/ivs/end-stage
  GET  /api/health/checkout
  GET  /api/business/*
  GET  /api/projects
  POST /api/projects

TO BUILD SPRINT 2:
  POST /api/merchant/signup
  GET  /api/merchant/stripe-connect/authorize
  GET  /api/merchant/stripe-connect/callback
  GET  /api/merchant/square/authorize
  GET  /api/merchant/square/callback
  GET  /api/merchant/dashboard
  GET  /api/merchant/qr-code

TO BUILD SPRINT 3+:
  POST /webhook/square
  POST /api/pickup/order
  GET  /api/merchant/display/:merchant_id
  POST /api/merchant/foottraffic/batch

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 12 — SOLANA BACKEND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Starbucks Odyssey model:
  Stripe on the front. Solana on the back.
  Users never touch crypto unless they choose to.

THREE STATES OF DUM:
  State 1: Off-chain points (default, 99% of users)
  State 2: Pending mint (background queue, invisible)
  State 3: On-chain tokens (optional, user-initiated)

SOLANA DETAILS:
  Program: FYgLqjJ7RHmT46xb5EiNGNa8XFbckqPWkEVLt2ztjnLV
  Network: Devnet now, mainnet after legal review
  Gas:     Platform pays ~$0.00025 per mint
  Key:     PLATFORM_KEYPAIR in secret manager only

RULES:
  Database always authoritative
  Solana is mirror only
  Minting always async — never blocks checkout
  Never marketed as investment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 13 — BACKGROUND WORKERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SOLANA MINT WORKER (every 5 minutes):
  Query mint_queue WHERE status = pending
  If no wallet: skip silently
  If wallet: call SPL mintTo
  Success: completed + log signature
  Failure: increment attempts, max 3 then failed
  Never crash on single job failure

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 14 — GREETER DEVICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Hardware: Raspberry Pi + touchscreen + PIR + speaker
Cost: ~$80-100 per unit
Languages: English, Spanish, Chinese, French,
           Portuguese, Hindi, Arabic
Status: HTML and Python built, API not wired
Rule: Sales tool only until 20+ merchants live

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 15 — ERROR HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Passive/background: log silently, never tell user
Webhook failures: 500 so Stripe retries
User-initiated claim: friendly error + retry
Universal: never crash worker, never lose transaction

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 16 — FRONTEND RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Language: DUM Points always. Never: token, crypto.
Balance: show every authenticated page
Wallet: optional, only after 100+ DUM earned
Payments: 100% Stripe for DUM Club transactions

LIVE COMMERCE UX (Sprint 1 complete):
  Camera-first seller flow
  Two-column desktop layout
  Mobile sticky buy bar
  Sale toasts bottom-left of video
  DUM Points confirmation top-right of video

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 17 — SECURITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PLATFORM_KEYPAIR: secret manager only, never .env
POS tokens: encrypted at rest (_enc), never returned
SUPABASE_SERVICE_KEY: backend only

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 18 — ENVIRONMENT VARIABLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_CONNECT_CLIENT_ID=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_ANON_KEY=
SOLANA_RPC_URL=
PLATFORM_KEYPAIR=
SPL_TOKEN_MINT_ADDRESS=
SQUARE_APPLICATION_ID=
SQUARE_APPLICATION_SECRET=
SQUARE_ENVIRONMENT=sandbox
DUM_REWARD_RATE=10
ENABLE_PICKUP_ORDERING=false
ENABLE_LIVE_FOOD_SHOWCASE=false
ENABLE_GREETER_DEVICE=false
ENABLE_FOOT_TRAFFIC=false
ENV=development

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 19 — WHAT NOT TO BUILD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Never build:
  Food delivery of any kind
  Driver recruitment or management
  Delivery dispatch or routing
  Any logistics infrastructure
  Our own POS hardware or software
  DUM purchasing with USD
  DUM transfers between users
  Liquidity pool or DEX
  Token value or price displays
  DUM staking for merchant tiers
  Mainnet before legal review
  Greeter productized before 20 merchants

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 20 — BUILD PRIORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SPRINT 1 — COMPLETE: Live commerce UX polish
SPRINT 2 — IN PROGRESS: Merchant onboarding
SPRINT 3: Square POS webhook + loyalty network
SPRINT 4: Pickup ordering
SPRINT 5: Live food showcase
SPRINT 6: Storefront — persistent listings
SPRINT 7: Greeter device API wiring

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 21 — SUSTAINABILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Infrastructure: ~$45-145/month total
Break even: 5 paying merchants
Founding period: first 50 merchants free
Goal: prove model before charging anyone

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 22 — HACKATHON DEMO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Create account
2. Stripe test purchase: 4242 4242 4242 4242
3. DUM Points appear within 10 seconds
4. Connect Phantom wallet
5. Claim DUM to wallet
6. Real SPL tokens on Solana devnet
7. Verify on Solana Explorer

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 23 — LOCKED TRUTHS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

We do not deliver food. Ever.
We bring customers to merchants.

Founding merchant pitch:
"Let me help you make money first."

One sprint. Done completely. Then next.
The code is not the problem.
Getting 10 merchants to say yes is the
only problem that matters right now.

"You solved the system.
 Now you have to solve people."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 24 — DEFINITION OF DONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SPRINT 1: DONE
SPRINT 2 done when:
  Merchant signs up under 2 minutes
  Founding merchant shown clearly
  Stripe Connect OAuth end to end
  Square OAuth end to end
  Dashboard with basic data
  QR code downloadable
  Zero cost for founding merchants
  No regressions on buyer flows

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 25 — UI DUPLICATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Scope:
  All owner-facing project pages and future
  merchant dashboards derived from this layout.

Definition:
  Primary source = most complete and actionable
  representation of a piece of information.
  Secondary source = any repeated display elsewhere.

Owner/merchant pages:
  Business Status card is primary source of truth
  Do not repeat information from:
    Business Status card
    Page hero
    About section

  Exception:
    Elements with unique actions must NOT be removed
    even if they display overlapping information.
    Only purely informational duplicates eliminated.

  Placement rule:
    Business Status card must remain visible
    above the fold on desktop and mobile.

  Approved branch:
    Show operational status only.
    Preserve live/rewards/checkout controls.
    Do not surface setup or review UI.

  Unapproved branch:
    Show status cards, next-step guidance,
    action buttons only.
    Do not repeat hero or about content.

  Enforcement:
    Check before adding any owner-facing element.
    If duplicate exists — do not add it.
    Never remove interactive elements in audit.
    TypeScript must pass after any removal.
    Visually verify both states after changes.

  Rule: Every UI element must earn its place
        or get deleted.
