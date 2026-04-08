# DUM Club — Customer acquisition machine for businesses

DUM Club is a customer acquisition machine for businesses. Users describe an idea and launch a business in under 60 seconds, or discover businesses on DUM Club and nearby in the real world, buy, earn DUM Points, and help bring new businesses into the ecosystem automatically.

---

## How it works

### Creator loop
1. **Describe** — one sentence is enough
2. **Generate** — AI drafts the project page, name, and token story
3. **Launch** — project goes live with a storefront, offers, and a demo token market
4. **Discover** — community finds the project and backs it through real offer purchases; demo token activity surfaces demand signal
5. **Evolve** — successful projects can unlock deeper offers after traction

### Growth engine loop
1. **Discover** — search for "pizza near me" and see DUM Club businesses plus nearby off-platform options, clearly labeled
2. **Buy** — purchase on DUM Club or at a nearby off-platform business
3. **Prove** — submit proof of purchase
4. **Reward** — earn DUM Points once the purchase is verified
5. **Acquire** — off-platform businesses get auto-invited to claim their DUM Club presence

---

## What makes it different

| vs ChatGPT | Ideas become launchable, not just answerable |
| vs Pump.fun | Structured project pages, AI, and guided creation |
| vs Shopify | No finished product required — demand discovery comes first |

---

## Core features

- **AI project creation** — describe it, we build the workspace, offers, and demo token story
- **Real Stripe checkout** — every project ships with offers + Stripe-powered payments
- **Demand-signal market (demo)** — simulated per-project price, market cap, and volume for demand-testing. See "Token role" below — real on-chain minting is not yet provisioned.
- **AI workspace** — AI chat per project
- **Wallet-based identity** — Privy sign-in with embedded Solana wallets
- **Off-platform growth engine** — search nearby businesses, submit proof of purchase, earn DUM Points, auto-invite merchants

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 + TypeScript |
| Backend | FastAPI (Python 3.11) |
| Database | Supabase + pgvector |
| AI | Ollama + LlamaIndex |
| Blockchain | Solana |
| Wallets | Phantom / Solflare / Backpack |

---

## Quick start

### 1. Clone + configure

```bash
git clone https://github.com/topgunmaintenance/Dum-Club.git
cd Dum-Club
cp .env.example .env
```

### 2. Start backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### 3. Start frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Token role

Per-project tokens on DUM Club today are **simulated**, not on-chain.
Every new project receives a `SIM_` placeholder mint address and an
in-app ledger that drives the price/market-cap/volume display on the
Exchange tab. No SPL mint, no liquidity pool, no real trading.

- Simulated price and volume = a demand signal, not an investment
- There are no holders of real tokens until on-chain minting ships
- DUM Points (the platform-wide loyalty currency) are separate and real;
  they have a Stripe on-ramp and an optional on-chain claim path

See `product.md` → "Token Role" for the language rules and
`backend/services/token_mode.py` + `frontend/lib/tokenMode.ts` for the
single-source-of-truth `is_simulated` helper.

---

Built on Solana · Powered by Ollama · Beta · Per-project token layer is currently a demo simulation
