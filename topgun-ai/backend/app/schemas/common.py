"""Shared pydantic schema primitives."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ConfidenceLabel = Literal["high", "medium", "low", "insufficient"]


class ConfidenceReport(BaseModel):
    """How much Topgun AI trusts this answer, and why."""

    score: float = Field(ge=0.0, le=1.0)
    label: ConfidenceLabel
    reason: str


class DocRef(BaseModel):
    """A compact reference to a document, used inside query responses."""

    id: str
    title: str
    type: str
