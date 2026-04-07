# Deployment Map

## Services

| Service | Platform | Domain | Branch |
|---------|----------|--------|--------|
| Frontend | Vercel | dum-club.vercel.app / dum.club | main |
| Backend | Railway | dum-club-production.up.railway.app | main |
| Database | Supabase | (managed) | N/A |
| Payments | Stripe | (managed, test mode) | N/A |

## CORS

Backend allows: dum.club, www.dum.club, dum-club.vercel.app, localhost:3000-3002, plus Vercel preview regex.

## Deploy flow

1. Push to main on GitHub
2. Vercel auto-deploys frontend
3. Railway auto-deploys backend
4. Both must be aligned for features to work

## Alignment check

Before declaring anything fixed:
- Confirm GitHub main commit
- Confirm Vercel deployed commit
- Confirm Railway deployed commit
- If misaligned: stop, resolve first

## Known deployment issues

- Railway hobby tier pauses during platform incidents
- Vercel preview deployments may have different env vars
- Stripe webhooks need the production backend URL configured
