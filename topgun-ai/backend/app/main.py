"""Topgun AI FastAPI application factory."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.core.config import get_settings
from app.core.demo_store import get_demo_store
from app.core.logging import configure_logging, get_logger

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    settings = get_settings()
    log.info("Topgun AI backend starting (env=%s, demo=%s)", settings.env, settings.demo_mode)
    if settings.demo_mode:
        get_demo_store()  # warm the store
    yield
    log.info("Topgun AI backend stopping")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Topgun AI",
        version=__version__,
        description=(
            "AI Maintenance Intelligence for Aviation Teams. "
            "Source-cited answers from manuals, records, and parts data."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")

    @app.get("/", tags=["meta"])
    def root() -> dict[str, str]:
        return {
            "name": "Topgun AI",
            "tagline": "AI Maintenance Intelligence for Aviation Teams",
            "version": __version__,
            "docs": "/docs",
        }

    return app


app = create_app()
