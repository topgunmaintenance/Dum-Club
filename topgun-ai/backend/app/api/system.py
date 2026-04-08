"""System status endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.system import SystemStatusResponse
from app.services.system_service import SystemService, get_system_service

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/status", response_model=SystemStatusResponse)
def get_status(
    service: SystemService = Depends(get_system_service),
) -> SystemStatusResponse:
    return service.status()
