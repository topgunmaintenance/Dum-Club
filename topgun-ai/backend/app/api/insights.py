"""Maintenance insights endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.insights import InsightsResponse
from app.services.insights_service import InsightsService, get_insights_service

router = APIRouter(prefix="/insights", tags=["insights"])


@router.get("", response_model=InsightsResponse)
def get_insights(
    service: InsightsService = Depends(get_insights_service),
) -> InsightsResponse:
    return service.snapshot()
