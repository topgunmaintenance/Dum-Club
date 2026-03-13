from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from api.routes import (
    vault,
    content,
    chat,
    transcribe,
    speech,
    users,
    projects,
    memories,
    generate_app,
    refine_project
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


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://dumclub.io"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(users.router,      prefix="/api/users",      tags=["Users"])
app.include_router(vault.router,      prefix="/api/vault",      tags=["Vault"])
app.include_router(content.router,    prefix="/api/content",    tags=["Content"])
app.include_router(chat.router,       prefix="/api/chat",       tags=["Chat"])
app.include_router(transcribe.router, prefix="/api/transcribe", tags=["Transcription"])
app.include_router(speech.router,     prefix="/api/speech",     tags=["Speech"])
app.include_router(projects.router,   prefix="/api/projects",   tags=["Projects"])
app.include_router(memories.router,   prefix="/api/memories",   tags=["Memories"])
app.include_router(generate_app.router, prefix="/api/generate-app", tags=["AI Generator"])

# NEW ROUTE
app.include_router(refine_project.router, prefix="/api/refine-project", tags=["AI Refiner"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "DUM Club API"}
