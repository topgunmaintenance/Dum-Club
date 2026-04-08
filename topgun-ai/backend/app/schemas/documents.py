"""Document-related request and response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DocumentType = Literal[
    "AMM",
    "IPC",
    "SB",
    "WORK_ORDER",
    "LOGBOOK",
    "TROUBLESHOOTING",
    "PARTS_CATALOG",
    "INSPECTION_PROGRAM",
    "UNKNOWN",
]

DocumentStatus = Literal["uploaded", "processing", "indexed", "failed"]


class DocumentSummary(BaseModel):
    """The shape used in document list views."""

    id: str
    title: str
    type: DocumentType
    aircraft: str | None = None
    source: str | None = None
    status: DocumentStatus
    pages: int | None = None
    size_mb: float | None = None
    uploaded_at: datetime | None = None
    uploaded_by: str | None = None
    tags: list[str] = Field(default_factory=list)


class DocumentDetail(DocumentSummary):
    summary: str | None = None


class DocumentListResponse(BaseModel):
    documents: list[DocumentSummary]
    total: int


class DocumentCreate(BaseModel):
    title: str
    type: DocumentType = "UNKNOWN"
    aircraft: str | None = None
    source: str | None = None
