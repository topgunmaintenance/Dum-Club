"""Business logic for the Maintenance Insights page."""
from __future__ import annotations

from app.core.demo_store import DemoStore, get_demo_store
from app.schemas.insights import (
    AtaHotspot,
    FleetWidget,
    InsightsResponse,
    RecurringCluster,
)


class InsightsService:
    def __init__(self, store: DemoStore) -> None:
        self._store = store

    def snapshot(self) -> InsightsResponse:
        raw = self._store.get_insights()
        return InsightsResponse(
            recurring_clusters=[
                RecurringCluster(**c) for c in raw.get("recurring_clusters", [])
            ],
            ata_hotspots=[AtaHotspot(**h) for h in raw.get("ata_hotspots", [])],
            fleet_widgets=[FleetWidget(**w) for w in raw.get("fleet_widgets", [])],
        )


def get_insights_service() -> InsightsService:
    return InsightsService(store=get_demo_store())
