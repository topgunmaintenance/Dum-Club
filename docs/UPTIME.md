# Uptime monitoring

Set up an external uptime monitor (UptimeRobot and Better Uptime both
have free tiers) against the backend health endpoint.

> **Important:** the health endpoints live on the **Railway backend
> service**, not on `www.dum.club`. Pointing UptimeRobot at
> `www.dum.club/api/health` will 404 — the Next.js app does not proxy
> `/api/*` to the backend; the frontend calls the backend over CORS
> using `NEXT_PUBLIC_API_URL`. Configure the monitor against the
> Railway public URL (e.g. `https://dum-club-api.up.railway.app`) —
> Railway dashboard → backend service → Settings → Domains.

## Primary monitor (liveness)

- **URL:** `https://<railway-backend>/api/health`
- **Method:** GET
- **Interval:** every 1 minute
- **Up condition:** HTTP 200 with JSON `{ "ok": true }`
- **Alert:** after **2 consecutive failures** (avoids paging on a single
  transient blip)
- **Notify:** julian@topgunmaintenance.com

`/api/health` is a pure liveness probe — it does not touch the database,
so it answers "is the API process up?" quickly and cheaply.

## Optional deeper monitor (readiness)

- **URL:** `https://<railway-backend>/api/health/ready`
- **Interval:** every 5 minutes
- **Up condition:** HTTP 200 with `{ "ok": true, "db": "ok" }`

`/api/health/ready` does a cheap head-count round-trip to Supabase, so it
catches database-reachability problems that liveness misses. Keep the
1-minute pager on `/api/health` and use `/ready` for a slower, deeper
signal so a momentary DB hiccup doesn't page every minute.

## Admin metrics (manual spot-check, not a monitor)

`GET https://<railway-backend>/api/health/metrics` returns an operational
snapshot (merchant counts, connected merchants, orders in 24h, failed
webhooks in 24h). It is **admin-gated** (`require_admin`) — call it with
an admin bearer token, not from an anonymous uptime monitor.

## Frontend uptime (optional)

If you also want to monitor that the Vercel frontend serves traffic:

- **URL:** `https://www.dum.club/` (or any static page like `/about`)
- **Interval:** every 5 minutes
- **Up condition:** HTTP 200

The frontend has no equivalent of `/api/health` — Next.js doesn't
auto-expose one — so check a known-static page that bypasses the
backend entirely. This catches Vercel-side outages independently of
Railway.
