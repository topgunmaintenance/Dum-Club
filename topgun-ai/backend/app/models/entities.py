"""Domain entities used by the ingestion and query layers."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Document:
    id: str
    title: str
    type: str
    aircraft: str | None = None
    source: str | None = None
    status: str = "uploaded"
    pages: int = 0
    size_mb: float = 0.0
    uploaded_at: datetime = field(default_factory=_now)
    uploaded_by: str | None = None
    tags: list[str] = field(default_factory=list)
    summary: str | None = None


@dataclass
class Chunk:
    id: str
    document_id: str
    page_start: int
    page_end: int
    position: int
    text: str
    embedding: list[float] | None = None


@dataclass
class Part:
    id: str
    part_number: str
    description: str
    aircraft: str | None = None
    notes: str | None = None


@dataclass
class IngestionJob:
    id: str
    document_id: str
    stage: str
    status: str
    started_at: datetime = field(default_factory=_now)
    finished_at: datetime | None = None
    detail: str | None = None
