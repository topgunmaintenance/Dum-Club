# DUM Club — Product Direction

## What We Are

DUM Club is a customer acquisition machine for businesses — an AI-powered business creation platform on Solana.

Users can describe an idea and launch a business in under 60 seconds. Users can also discover businesses on DUM Club or nearby in the real world, make purchases, earn DUM Points, and help bring new businesses into the DUM Club ecosystem automatically.

A user describes an idea. AI builds the storefront, generates offers, configures payments, and launches a live project page — all in under 60 seconds.

The surface experience is business-first: storefronts, offers, supporters, rewards.
The underlying infrastructure is crypto-powered: tokens, trading, on-chain activity.

---

## Core Loops

DUM Club runs two loops side by side. Both loops share the same user base, storefront UI, and DUM Points economy.

### Creator Loop — Describe → Launch → Grow

1. **Describe** — user types an idea (one sentence is enough)
2. **Launch** — AI generates storefront, offers, payments, and token
3. **Grow** — customers buy, supporters back the project, business scales

### Growth Engine Loop — Discover → Buy → Prove → Reward → Acquire

1. **Discover** — a user searches for something like "pizza near me" and sees DUM Club businesses plus nearby off-platform businesses, clearly labeled
2. **Buy** — the user purchases from a nearby off-platform business (or an on-platform one)
3. **Prove** — the user uploads a receipt / manual proof of purchase
4. **Reward** — verified purchases earn DUM Points and create a referral attribution to the buyer
5. **Acquire** — DUM Club automatically queues outreach to the off-platform business so it can claim its DUM Club presence

This makes DUM Club simultaneously a **discovery engine**, a **loyalty engine**, a **referral engine**, and a **business acquisition engine**.

---

## Off-Platform → On-Platform Growth Engine

The growth engine is powered by three deterministic agent modules in `backend/services/agents/`:

- **Local Discovery Agent** — interprets the user query, returns DUM Club matches and nearby off-platform businesses as a single merged, labeled result set.
- **Purchase Proof Agent** *(future PR)* — accepts receipt input, parses merchant/amount/date, scores confidence, and routes to approve / review / reject.
- **Rewards Agent** *(future PR)* — centralises DUM Point calculation, abuse prevention, ledger writes, business attribution, and follow-up triggers.

Agents are thin, deterministic, and testable with mocked dependencies. They are **additive** over the existing search, external-places, and external-business routes — they do not replace them. Rewards MUST eventually flow only through the Rewards Agent, but the existing `external_business.py` verify-path stays intact until that dedicated PR ships.

---

## Hybrid Model

DUM Club uses a hybrid business/crypto model:

### Storefront (Default — what everyone sees)
- Business names, descriptions, offers, pricing
- "Supporters" not "token holders"
- "Perks" not "token utility"
- "Back this project" not "Buy $TOKEN"
- Payments via Stripe, no crypto knowledge needed

### Exchange (Advanced — opt-in for power users)
- Token price, market cap, volume, trading
- Buy/sell panel, charts, candles
- Full crypto-native experience
- Accessed via "Exchange" tab on project page

**Rule:** A normal user should be able to use Dum Club for weeks without ever knowing crypto is involved.

---

## What We Are NOT

- We are NOT a direct service redemption marketplace
- We are NOT leading with "buy a token, receive a guaranteed service"
- We are NOT making investment promises or securities-like claims
- We are NOT a crypto dashboard disguised as a business tool

---

## Positioning

**Primary:** AI-powered business creation — fastest path from idea to live storefront with payments

**Secondary:** Off-platform → on-platform growth engine — users discover, buy, prove, and earn; businesses gain customers and get auto-invited into the ecosystem

**Tertiary:** Community-backed projects — supporters back ideas they believe in and unlock perks

**Quaternary:** Token-powered infrastructure — on-chain tokens provide the economic layer underneath

---

## Target User

Someone with an idea who wants to:
- Turn it into a business instantly without technical setup
- Start accepting payments and customers the same day
- Build community support around their idea
- Scale with built-in rewards and loyalty mechanics

---

## Key Differentiators

| vs Shopify | No finished product needed — describe and launch |
| vs Base44 / Lovable | Output is a revenue-generating business, not just an app |
| vs Venice.ai | Users make money, not just consume AI |
| vs Pump.fun | Structured business pages with real offers and payments |

---

## Token Role

Tokens operate underneath the business layer:

- **For supporters:** Holding tokens unlocks perks, discounts, and priority access
- **For creators:** Token activity signals community interest and demand
- **For the platform:** Transaction fees fund token burns, creating a value flywheel

Tokens are NEVER the first thing a user sees. They are discovered through the Exchange tab or through deeper engagement.

---

## Language Guidelines

**Use (Storefront/default):**
- "launch your idea"
- "build your storefront"
- "supporters"
- "back this project"
- "perks" / "rewards"
- "community"
- "start selling"

**Use (Exchange/advanced):**
- "token" / "trade" / "market"
- "buy" / "sell"
- "price" / "volume" / "market cap"

**Avoid everywhere:**
- "guaranteed service"
- "investment" / "returns"
- "securities"
- "it's like stocks"
- "tokenized human economy"

---

## Monetization

- Platform fee (7%) on every offer purchase via Stripe
- Future: portion of fees used to buy and burn DUM tokens
- Future: Pro tier unlocked by holding DUM tokens (no subscription needed)
- Future: featured placement for projects with high activity

---

## Current Transition Priority

We are moving toward an input-first experience:
- Homepage textarea as the primary entry point
- Zero onboarding — users become businesses by launching
- Template starters to reduce blank-page anxiety
- /build remains as a secondary dedicated launch page

See `claude.md` for implementation rules.
