# Uptime monitoring

Set up an external uptime monitor (UptimeRobot and Better Uptime both
have free tiers) against the backend health endpoint.

## Primary monitor (liveness)

- **URL:** `https://www.dum.club/api/health`
- **Method:** GET
- **Interval:** every 1 minute
- **Up condition:** HTTP 200 with JSON `{ "ok": true }`
- **Alert:** after **2 consecutive failures** (avoids paging on a single
  transient blip)
- **Notify:** julian@topgunmaintenance.com

`/api/health` is a pure liveness probe — it does not touch the database,
so it answers "is the API process up?" quickly and cheaply.

## Optional deeper monitor (readiness)

- **URL:** `https://www.dum.club/api/health/ready`
- **Interval:** every 5 minutes
- **Up condition:** HTTP 200 with `{ "ok": true, "db": "ok" }`

`/api/health/ready` does a cheap head-count round-trip to Supabase, so it
catches database-reachability problems that liveness misses. Keep the
1-minute pager on `/api/health` and use `/ready` for a slower, deeper
signal so a momentary DB hiccup doesn't page every minute.

## Admin metrics (manual spot-check, not a monitor)

`GET https://www.dum.club/api/health/metrics` returns an operational
snapshot (merchant counts, connected merchants, orders in 24h, failed
webhooks in 24h). It is **admin-gated** (`require_admin`) — call it with
an admin bearer token, not from an anonymous uptime monitor.
