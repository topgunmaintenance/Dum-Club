"""
When running `python -m uvicorn backend.main:app` from the repo root, Python only
puts the repo root on sys.path, so imports like `from api.routes` fail unless the
`backend/` directory is also on the path. Bootstrap once here before any local imports.
"""
import sys
from pathlib import Path

_backend_dir = Path(__file__).resolve().parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import (
    auth,
    admin,
    vault,
    content,
    chat,
    transcribe,
    speech,
    users,
    projects,
    memories,
    generate_app,
    refine_project,
    token,
    investor_leads,
    project_tokens,
    market,
    booking,
    live_reminders,
    reports,
    launch,
    offers,
    checkout,
    health,
    dum_points,
    business,
    favorites,
    category_follows,
    reviews,
    referrals,
    ai_chat,
    ai_homepage,
    search,
    external_business,
    feature_flags,
    auctions,
    ivs,
    auction_ws,
    merchant,
    outreach,
    analytics,
    popin,
    guest_chat,
)

from db.supabase import init_supabase


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_supabase()
    # Phase 0 livestream cost-protection: sweep orphaned is_live=true
    # projects on startup. Two cases to handle separately to avoid
    # clipping a stream during the 5-second window between deploy
    # completion and the host's first heartbeat write under the new
    # persistence code:
    #
    #   (a) last_heartbeat_at IS NOT NULL AND older than 5 minutes
    #       — definitely abandoned, clear immediately.
    #   (b) last_heartbeat_at IS NULL AND updated_at older than 10 min
    #       — pre-migration-059 orphan or a stream whose host hung up
    #       long ago. The 10-minute updated_at buffer protects fresh
    #       go-lives whose first heartbeat hasn't written yet.
    #
    # Best-effort; never blocks app startup on a Supabase hiccup.
    try:
        from datetime import datetime, timezone, timedelta
        from db.supabase import get_client
        supabase = get_client()
        now_iso = datetime.now(timezone.utc)
        stale_heartbeat_cutoff = (now_iso - timedelta(minutes=5)).isoformat()
        no_heartbeat_cutoff    = (now_iso - timedelta(minutes=10)).isoformat()
        clear_fields = {
            "is_live": False,
            "ivs_stage_arn": None,
            "ivs_stage_id": None,
            "live_provider": None,
            "live_stream_id": None,
            "live_playback_id": None,
            "live_stream_key": None,
            "live_ingest_url": None,
            "stream_url": None,
        }
        # Case (a): explicit stale heartbeat.
        a_res = (
            supabase.table("projects")
            .update(clear_fields)
            .eq("is_live", True)
            .not_.is_("last_heartbeat_at", "null")
            .lt("last_heartbeat_at", stale_heartbeat_cutoff)
            .execute()
        )
        a_cleared = len(a_res.data or [])
        # Case (b): NULL heartbeat + old updated_at.
        b_res = (
            supabase.table("projects")
            .update(clear_fields)
            .eq("is_live", True)
            .is_("last_heartbeat_at", "null")
            .lt("updated_at", no_heartbeat_cutoff)
            .execute()
        )
        b_cleared = len(b_res.data or [])
        total = a_cleared + b_cleared
        if total:
            print(
                f"[startup] Cleared {total} orphaned live stream(s) "
                f"(stale_heartbeat={a_cleared}, null_heartbeat_old_update={b_cleared})"
            )
        else:
            print("[startup] No orphaned live streams found")
    except Exception as exc:
        print(f"[startup] Stale stream sweep failed: {exc!r}")

    # Discover-feed cache warmer (visual audit 2026-07-06): keeps the
    # default /api/projects/discover page precomputed so first visitors
    # never wait out the ~1.2s server-side market loop. Re-warms just
    # inside the cache TTL. Best-effort background task; cancelled
    # cleanly on shutdown.
    import asyncio

    async def _discover_warm_loop():
        from api.routes.projects import warm_discover_cache, _DISCOVER_TTL

        while True:
            try:
                await warm_discover_cache()
            except Exception as exc:
                print(f"[warm] discover cache warm failed: {exc!r}")
            await asyncio.sleep(max(5.0, _DISCOVER_TTL - 5.0))

    warm_task = asyncio.create_task(_discover_warm_loop())
    try:
        yield
    finally:
        warm_task.cancel()


# ── Sentry (optional) ─────────────────────────────────────────
# Guarded init: a no-op unless BOTH sentry-sdk is installed AND
# SENTRY_DSN_BACKEND is set. This keeps the import safe in environments
# where the SDK isn't installed yet (the dependency is declared in
# requirements.txt for the operator to install on deploy). See
# docs/OBSERVABILITY.md for the frontend wiring + DSN setup.
try:
    if os.getenv("SENTRY_DSN_BACKEND"):
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration

        sentry_sdk.init(
            dsn=os.environ["SENTRY_DSN_BACKEND"],
            traces_sample_rate=0.1,
            environment=os.getenv("RAILWAY_ENVIRONMENT", "development"),
            integrations=[FastApiIntegration()],
        )
except Exception as _sentry_exc:  # noqa: BLE001
    print(f"[sentry] backend init skipped: {_sentry_exc!r}")


app = FastAPI(
    title="DUM Club API",
    description="Digital Utility Model Club — Solana-native AI app builder",
    version="0.2.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

_LOCALHOST_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
]

# Exact-match allowlist kept as belt-and-suspenders for canonical production
# hostnames. The regex below is the primary matcher (it's broader, robust to
# new subdomains and Vercel preview aliases); this list is here so an origin
# we care about will still match even if the regex is later edited incorrectly.
_PRODUCTION_ORIGINS = [
    "https://dum-club.vercel.app",
    "https://www.dum-club.vercel.app",
    "https://dum.club",
    "https://www.dum.club",
    "https://dum-club-production.up.railway.app",
]


def _build_cors_origins() -> list[str]:
    origins = list(_LOCALHOST_ORIGINS) + list(_PRODUCTION_ORIGINS)
    for var in ("FRONTEND_URL", "FRONTEND_PREVIEW_URL"):
        val = os.getenv(var, "").strip().rstrip("/")
        if val and val not in origins:
            origins.append(val)
    return origins


# Single regex covering every hostname we expect to serve in production,
# preview, and local dev. Starlette's CORSMiddleware runs re.fullmatch
# against the incoming Origin header, so each alternative must match the
# entire origin string.
#
# Covered:
#   https://dum.club                                          (apex)
#   https://<anything>.dum.club                               (www + future subdomains)
#   https://dum-club<anything>.vercel.app                     (project-first Vercel previews)
#   https://<anything>-topgun-maintenances-projects.vercel.app (team-scoped Vercel previews)
#   https://dum-club<anything>.up.railway.app                 (Railway prod + clones)
#   http://localhost:<port> and http://127.0.0.1:<port>       (local dev, any port)
_CORS_ALLOWED_ORIGIN_REGEX = (
    r"^https://("
    r"(?:[a-z0-9-]+\.)?dum\.club"
    r"|dum-club[a-z0-9-]*\.vercel\.app"
    r"|[a-z0-9-]+-topgun-maintenances-projects\.vercel\.app"
    r"|dum-club[a-z0-9-]*\.up\.railway\.app"
    r")$"
    r"|^http://localhost:\d+$"
    r"|^http://127\.0\.0\.1:\d+$"
)


class CORSMissLogger:
    """
    Forensic logger for CORS misses.

    Emits exactly one line when an /api/* request arrives with an Origin
    header but the response leaves without Access-Control-Allow-Origin —
    i.e. Starlette's CORSMiddleware decided the origin wasn't allowed and
    silently dropped the header, which looks to the browser like a CORS
    block. Without this log the same class of bug is invisible in Railway
    logs (the request still returns 200 on the wire).

    Silent on hits. Pure ASGI, no response buffering, so streaming
    responses (SSE on /api/chat/*) pass through untouched.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "")
        origin: str | None = None
        for name, value in scope.get("headers", []):
            if name == b"origin":
                origin = value.decode("latin-1")
                break

        acao_seen = False

        async def send_wrapper(message):
            nonlocal acao_seen
            if message.get("type") == "http.response.start":
                for name, _ in message.get("headers", []):
                    if name == b"access-control-allow-origin":
                        acao_seen = True
                        break
            await send(message)

        await self.app(scope, receive, send_wrapper)

        if origin and path.startswith("/api") and not acao_seen:
            print(f"[cors] MISS method={method} path={path} origin={origin!r}")


# Middleware registration order matters in Starlette: the LAST add_middleware
# call becomes the OUTERMOST layer (processes request first, response last).
# We want CORSMiddleware to handle OPTIONS preflights directly and add ACAO
# on the response, then CORSMissLogger to observe the final response. So
# register CORS first (inner), then the logger (outer).
app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_cors_origins(),
    allow_origin_regex=_CORS_ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)
app.add_middleware(CORSMissLogger)

print(
    f"[cors] startup: {len(_build_cors_origins())} exact origins + regex; "
    f"regex={_CORS_ALLOWED_ORIGIN_REGEX!r}"
)


# Core API Routes
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(vault.router, prefix="/api/vault", tags=["Vault"])
app.include_router(content.router, prefix="/api/content", tags=["Content"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(transcribe.router, prefix="/api/transcribe", tags=["Transcription"])
app.include_router(speech.router, prefix="/api/speech", tags=["Speech"])
app.include_router(projects.router, prefix="/api/projects", tags=["Projects"])
app.include_router(memories.router, prefix="/api/memories", tags=["Memories"])
app.include_router(investor_leads.router, prefix="/api/investor-leads", tags=["Investor Leads"])
app.include_router(project_tokens.router, prefix="/api", tags=["Project Tokens"])
app.include_router(market.router, tags=["Market"])
app.include_router(booking.router, tags=["Booking"])
app.include_router(live_reminders.router, prefix="/api", tags=["Live Reminders"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(auth.router)
app.include_router(admin.router)

# AI Generator Routes
app.include_router(generate_app.router, prefix="/api/generate-app", tags=["AI Generator"])
app.include_router(refine_project.router, prefix="/api/refine-project", tags=["AI Refiner"])
app.include_router(launch.router, prefix="/api/launch", tags=["Launch"])

# Offers & Checkout
app.include_router(offers.router, prefix="/api/offers", tags=["Offers"])
app.include_router(checkout.router, prefix="/api/checkout", tags=["Checkout"])

# System Health
app.include_router(health.router, prefix="/api/health", tags=["Health"])

# DUM Points
app.include_router(dum_points.router, prefix="/api/dum", tags=["DUM Points"])

# Business Profiles
app.include_router(business.router, prefix="/api/business", tags=["Business"])

# Pop-In recorded-video uploads (server-mediated, Path 2 hardening
# sprint PR 1). Thin one-route module — POST /api/popin/upload-video.
app.include_router(popin.router, prefix="/api/popin", tags=["Popin"])

# Token Creation (NO PREFIX so route stays clean)
app.include_router(token.router, tags=["Token"])

# Phase 4: Growth & Social
app.include_router(favorites.router, prefix="/api/favorites", tags=["Favorites"])
app.include_router(category_follows.router, prefix="/api/category-follows", tags=["Category Follows"])
app.include_router(reviews.router, prefix="/api/reviews", tags=["Reviews"])
app.include_router(referrals.router, prefix="/api/referrals", tags=["Referrals"])

# AI Sales Assistant
app.include_router(ai_chat.router, prefix="/api/ai", tags=["AI Chat"])
app.include_router(ai_homepage.router, prefix="/api/ai", tags=["AI Homepage"])

# Search
app.include_router(search.router, prefix="/api/search", tags=["Search"])

# Off-platform demand capture
app.include_router(external_business.router, prefix="/api/external", tags=["External Business"])
app.include_router(feature_flags.router, prefix="/api", tags=["Feature Flags"])

# Guest chat (storefront visitor -> merchant messaging). Tables provisioned
# by a separate migration (draft 076), applied out-of-band.
app.include_router(guest_chat.router, prefix="/api/guest", tags=["Guest Chat"])
app.include_router(auctions.router, prefix="/api/auctions", tags=["Auctions"])
app.include_router(ivs.router, prefix="/api/ivs", tags=["IVS Real-Time"])
app.include_router(auction_ws.router, prefix="/api/auction-ws", tags=["Auction WebSocket"])
app.include_router(merchant.router, prefix="/api/merchant", tags=["Merchant"])
app.include_router(outreach.router, prefix="/api/outreach", tags=["Merchant Outreach"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Drive Your Market Analytics"])


@app.get("/health")
async def health_liveness():
    return {"status": "ok", "service": "DUM Club API"}
