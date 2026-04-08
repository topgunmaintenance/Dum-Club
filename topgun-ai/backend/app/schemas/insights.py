"""Maintenance insights response schemas."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

TrendDirection = Literal["rising", "falling", "flat", "stable"]
Severity = Literal["low", "medium", "high"]


class RecurringCluster(BaseModel):
    id: str
    title: str
    aircraft: str
    ata: str
    count_90d: int
    aircraft_count: int
    trend: TrendDirection
    last_occurred: str
    severity: Severity
    notes: str | None = None


class AtaHotspot(BaseModel):
    ata: str
    label: str
    count_90d: int
    delta_pct: float


class FleetWidget(BaseModel):
    id: str
    label: str
    value: float
    unit: str | None = None
    trend: TrendDirection
    detail: str | None = None


class InsightsResponse(BaseModel):
    recurring_clusters: list[RecurringCluster] = Field(default_factory=list)
    ata_hotspots: list[AtaHotspot] = Field(default_factory=list)
    fleet_widgets: list[FleetWidget] = Field(default_factory=list)
