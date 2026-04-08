"""System status service."""
from __future__ import annotations

from app import __version__
from app.core.config import get_settings
from app.core.demo_store import DemoStore, get_demo_store
from app.schemas.system import (
    ProcessingLogEntry,
    SystemComponent,
    SystemStatusResponse,
)


class SystemService:
    def __init__(self, store: DemoStore) -> None:
        self._store = store

    def status(self) -> SystemStatusResponse:
        settings = get_settings()
        raw = self._store.get_insights()
        return SystemStatusResponse(
            components=[SystemComponent(**c) for c in raw.get("system_status", [])],
            logs=[ProcessingLogEntry(**log) for log in raw.get("processing_logs", [])],
            version=__version__,
            demo_mode=settings.demo_mode,
            ai_provider=settings.ai_provider,
        )


def get_system_service() -> SystemService:
    return SystemService(store=get_demo_store())
