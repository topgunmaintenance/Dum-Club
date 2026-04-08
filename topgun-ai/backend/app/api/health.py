"""Health check endpoint."""
from fastapi import APIRouter

from app import __version__
from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "version": __version__,
        "env": settings.env,
        "demo_mode": settings.demo_mode,
        "ai_provider": settings.ai_provider,
    }
