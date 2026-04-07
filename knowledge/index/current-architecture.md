# Current Architecture

## Stack

| Layer | Tech | Host |
|-------|------|------|
| Frontend | Next.js 14 (App Router) + Tailwind | Vercel |
| Backend | FastAPI (Python 3.11) | Railway |
| Database | Supabase (Postgres) | Supabase Cloud |
| Auth | Privy (Google + embedded Solana wallet) | Privy Cloud |
| Payments | Stripe (test mode) | Stripe |
| AI | Claude API (Haiku) via Anthropic SDK | Anthropic |
| Blockchain | Solana devnet (SPL tokens, DUM mint) | Solana RPC |

## Key backend routes

| Route | Purpose |
|-------|---------|
| POST /api/launch/ | AI business generation from idea |
| GET /api/projects/public | List live businesses |
| GET /api/projects/{id} | Project detail |
| GET /api/offers/{project_id} | List active offers |
| POST /api/checkout/create-payment-intent | Stripe checkout |
| POST /api/checkout/webhook | Stripe webhook |
| POST /api/ai/project-chat | Customer-facing AI assistant |
| POST /api/chat/project-gated | Owner AI workspace |
| GET /api/dum/balance/{privy_id} | DUM Points balance |
| POST /api/dum/claim | Claim DUM to wallet |
| GET /api/dum/claimable/{privy_id} | Earned claimable amount |

## Key frontend pages

| Route | Purpose |
|-------|---------|
| / | Homepage with hero textarea + launch |
| /discover | Browse live businesses |
| /project/[id] | Project page + AI chat + offers + checkout |
| /hub | DUM Hub (Points, Claim, Use, Market, Refer) |
| /build | Dedicated launch page |
| /business | For Business landing page |
| /dashboard | User's businesses |

## Database tables (critical)

projects, offers, orders, users, dum_transactions, business_profiles, favorites, reviews, referrals

## Environment variables (required for production)

SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, PRIVY_APP_ID, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_PRIVY_APP_ID
