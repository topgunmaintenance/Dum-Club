# DUM Club — Customer acquisition machine for businesses

DUM Club is a customer acquisition machine for businesses. Users describe an idea and launch a business in under 60 seconds, or discover businesses on DUM Club and nearby in the real world, buy, earn DUM Points, and help bring new businesses into the ecosystem automatically.

---

## How it works

### Creator loop
1. **Describe** — one sentence is enough
2. **Generate** — AI drafts the project page, name, and token story
3. **Launch** — project goes live with a public market feed
4. **Discover** — community finds it, trades the token, signals demand
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

- **AI project creation** — describe it, we build the workspace and token story
- **Live token activity** — price, market cap, and momentum on every project
- **Demand signals** — token activity shows what the community believes in
- **AI workspace** — token-gated AI chat per project
- **Wallet-based identity** — Phantom, Solflare, Backpack

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

Tokens are demand signals, not service vouchers.

- Token price and volume = community interest in the idea
- Holders = early supporters and community members
- Future utility layers in after traction is proven

---

Built on Solana · Powered by Ollama · Beta
