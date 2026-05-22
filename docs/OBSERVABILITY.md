# Observability

What's shipped, and the operator steps to finish wiring it up.

## Shipped in this repo

- **`GET /api/health`** — liveness (no DB). Returns commit + environment.
- **`GET /api/health/ready`** — readiness; pings Supabase.
- **`GET /api/health/metrics`** — admin-gated operational snapshot
  (merchants total/connected/new, orders 24h, failed webhooks 24h).
- **Backend Sentry init** — guarded in `backend/main.py`. A no-op until
  the SDK is installed and `SENTRY_DSN_BACKEND` is set. `sentry-sdk[fastapi]`
  is declared in `backend/requirements.txt`.
- **`docs/UPTIME.md`** — uptime monitor setup.

## Operator steps to finish

### 1. Backend Sentry (one env var)

`sentry-sdk[fastapi]` is already in requirements. Just set on Railway:

```
SENTRY_DSN_BACKEND=<your backend DSN>
```

The guarded init in `main.py` activates automatically (10% traces,
environment tagged from `RAILWAY_ENVIRONMENT`).

### 2. Frontend Sentry (needs an install — not done in-repo)

Frontend Sentry was **not** added to the codebase because it requires
installing `@sentry/nextjs` (a build-time dependency). Adding the config
files before the package is installed would break `next build`. Run the
wizard from `frontend/`:

```
cd frontend
npx @sentry/wizard@latest -i nextjs
```

Then set in the Vercel project:

```
NEXT_PUBLIC_SENTRY_DSN=<frontend DSN>
SENTRY_AUTH_TOKEN=<token>
SENTRY_ORG=<org>
SENTRY_PROJECT=<project>
```

Recommended config in the generated `sentry.client.config.ts`:

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
  beforeSend(event) {
    // Drop health-check noise and any stray agent-overlay leakage.
    const url = event.request?.url || "";
    if (url.includes("/api/health")) return null;
    if (JSON.stringify(event).includes("Stop Claude")) return null;
    return event;
  },
});
```

Do **not** enable session replay on authenticated dashboard routes
(`/dashboard/*`) — privacy.

## Follow-ups (deliberately deferred)

- **Structured JSON logging.** The backend still uses `print()` in many
  routes. A full migration to structured logs (structlog or stdlib
  `python-json-logger`) with `request_id` / `route` / `duration_ms` is a
  large, cross-cutting sweep best done as its own PR so each replaced log
  line keeps its context. Not bundled here to keep this PR reviewable and
  to avoid touching every route blind.
- **Request-latency percentiles.** `/api/health/metrics` returns
  `latency_ms: null`. p50/p95/p99 need an in-process timing ring buffer
  fed by an ASGI middleware. Add the middleware + buffer, then populate
  the field. Deferred with structured logging since both touch the
  request pipeline.
