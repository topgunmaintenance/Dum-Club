# Known Risks

## Production risks

- Railway hobby tier pauses during platform incidents — backend goes down
- Supabase connection failure crashes any endpoint without try/except
- ANTHROPIC_API_KEY missing = AI assistant returns 503
- Stripe webhook misconfiguration = orders stuck in pending_payment

## Code risks

- project/[id]/page.tsx is 5,732 lines — monolithic, hard to refactor safely
- page.tsx (homepage) is 2,261 lines with 20 useEffects
- No code splitting or dynamic imports — large initial bundle
- Starfield canvas runs on every page (throttled to 30fps now)

## AI risks

- Claude could hallucinate offer details not in the data
- Mitigated by strict prompt constraints + structured offer data
- If Claude invents a refund policy or delivery time, customer trust breaks
- Current mitigation: "That's not listed here" fallback phrase

## Data risks

- Missing tables (reviews, favorites, referrals) caused 990 errors/sec log storm
- Fixed with try/except fallbacks + tables created in Supabase
- DUM Points balance stored in both users.dum_balance and dum_transactions
- If they drift: dum_transactions is source of truth

## Security risks

- Launch endpoint has no auth (anyone can create projects)
- Rate limited to 5 per wallet per 24h
- AI chat endpoint has no auth (by design — it's for customers)
- Checkout requires Privy auth
