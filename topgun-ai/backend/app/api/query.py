"""Query workspace endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.schemas.query import QueryRequest, QueryResponse
from app.services.query_service import QueryService, get_query_service

router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=QueryResponse)
def ask(
    request: QueryRequest,
    service: QueryService = Depends(get_query_service),
) -> QueryResponse:
    return service.ask(request)


@router.get("/recent")
def recent_queries(
    limit: int = 5,
    service: QueryService = Depends(get_query_service),
) -> list[dict]:
    return service.recent(limit=limit)
