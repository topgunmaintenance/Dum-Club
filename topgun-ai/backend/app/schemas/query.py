"""Query workspace request/response schemas."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ConfidenceReport, DocRef


class QueryRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    aircraft: str | None = None
    document_types: list[str] | None = None
    sources: list[str] | None = None
    max_citations: int = Field(default=6, ge=1, le=20)


class AnswerSection(BaseModel):
    heading: str
    bullets: list[str]


class Citation(BaseModel):
    document_id: str
    document_title: str
    document_type: str
    page: int
    snippet: str
    score: float = Field(ge=0.0, le=1.0)
    lane: Literal["manual", "history", "parts", "pattern"]


class ExtractedEntity(BaseModel):
    kind: Literal[
        "aircraft",
        "tail_number",
        "ata",
        "part_number",
        "bulletin",
        "inspector",
        "date",
    ]
    value: str


class QueryResponse(BaseModel):
    question: str
    answer: str
    sections: list[AnswerSection] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    related_documents: list[DocRef] = Field(default_factory=list)
    entities: list[ExtractedEntity] = Field(default_factory=list)
    confidence: ConfidenceReport
    followups: list[str] = Field(default_factory=list)
    latency_ms: int = 0
