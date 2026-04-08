"""System health and processing-log schemas."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ComponentStatus = Literal["healthy", "degraded", "down"]


class SystemComponent(BaseModel):
    id: str
    label: str
    status: ComponentStatus


class ProcessingLogEntry(BaseModel):
    ts: str
    stage: str
    doc: str
    status: str
    detail: str | None = None


class SystemStatusResponse(BaseModel):
    components: list[SystemComponent] = Field(default_factory=list)
    logs: list[ProcessingLogEntry] = Field(default_factory=list)
    version: str
    demo_mode: bool
    ai_provider: str
