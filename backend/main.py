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
    project_tokens,
    market,
    booking,
    launch,
    offers,
    checkout,
    health,
    dum_points,
    business,
    favorites,
    reviews,
    referrals,
    ai_chat,
    ai_homepage,
)

from db.supabase import init_supabase


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_supabase()
    yield


app = FastAPI(
    title="DUM Club API",
    description="Digital Utility Model Club — Solana-native AI app builder",
    version="0.2.0",
    lifespan=lifespan,
)

_LOCALHOST_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
]

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

# Regex to match all Vercel preview deployments for this project
_VERCEL_PREVIEW_REGEX = r"https://dum-club[a-z0-9\-]*\.vercel\.app|https://dum-club[a-z0-9\-]*\.up\.railway\.app"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_build_cors_origins(),
    allow_origin_regex=_VERCEL_PREVIEW_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
app.include_router(project_tokens.router, prefix="/api", tags=["Project Tokens"])
app.include_router(market.router, tags=["Market"])
app.include_router(booking.router, tags=["Booking"])
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

# Token Creation (NO PREFIX so route stays clean)
app.include_router(token.router, tags=["Token"])

# Phase 4: Growth & Social
app.include_router(favorites.router, prefix="/api/favorites", tags=["Favorites"])
app.include_router(reviews.router, prefix="/api/reviews", tags=["Reviews"])
app.include_router(referrals.router, prefix="/api/referrals", tags=["Referrals"])

# AI Sales Assistant
app.include_router(ai_chat.router, prefix="/api/ai", tags=["AI Chat"])
app.include_router(ai_homepage.router, prefix="/api/ai", tags=["AI Homepage"])


@app.get("/health")
async def health_liveness():
    return {"status": "ok", "service": "DUM Club API"}
