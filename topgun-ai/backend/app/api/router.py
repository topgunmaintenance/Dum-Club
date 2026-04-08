"""Top-level API router assembly."""
from fastapi import APIRouter

from app.api import auth, documents, health, insights, query, system

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(documents.router)
api_router.include_router(query.router)
api_router.include_router(insights.router)
api_router.include_router(system.router)
api_router.include_router(auth.router)
