"""
Drive Your Market Analytics — events ingestion endpoint.

Public POST endpoint that accepts event rows from the embed +
project pages (browser clients). Validates the event_type allow-list
matching the CHECK constraint on merchant_analytics_events. Soft
rate-limit per anonymous_visitor_id via the existing live_limits
sliding-window utility — over-limit requests return 200 with a
silent no-op so a malicious client can't tell whether their event
was recorded (and so production page loads never see a 4xx from
analytics).

The dashboard summary endpoint lives on /api/business/analytics
(extended in business.py to add the funnel + visitor metrics) so
merchants only call one place.
"""

from __future__ import annotations

from typing import Optional, Any
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from db.supabase import get_client
from services.live_limits import check_rate_limit

router = APIRouter()


ALLOWED_EVENT_TYPES = {
    "embed_view",
    "project_view",
    "offer_view",
    "checkout_start",
    "purchase_completed",
    "live_view",
    "return_visit",
}

# Soft cap. The events that come out of normal browsing
# (mount + scroll + click) are well below this. Set high enough that
# a normal merchant page session never hits it; low enough that a
# scripted attacker can't fill the table.
MAX_EVENTS_PER_VISITOR_PER_MIN = 120


class EventIn(BaseModel):
    event_type: str
    project_id: Optional[str] = None
    offer_id: Optional[str] = None
    anonymous_visitor_id: Optional[str] = None
    session_id: Optional[str] = None
    metadata: Optional[dict[str, Any]] = Field(default=None)


@router.post("/event")
async def post_event(payload: EventIn, request: Request) -> dict:
    """
    Accept a single analytics event. Returns {"ok": true} unconditionally
    so the client never has to handle a failure path — the whole point
    of this surface is "fire and forget."
    """
    # 1. Allow-list check — drop unknown event types silently
    if payload.event_type not in ALLOWED_EVENT_TYPES:
        return {"ok": True}

    # 2. Rate-limit per visitor (or per IP fallback if no visitor id)
    rate_key = (
        payload.anonymous_visitor_id
        or (request.client.host if request.client else "unknown")
    )
    if check_rate_limit(rate_key, "analytics_event", MAX_EVENTS_PER_VISITOR_PER_MIN):
        return {"ok": True}

    # 3. Best-effort insert. Any DB error is swallowed — analytics must
    #    never break a page load.
    try:
        row: dict[str, Any] = {
            "event_type": payload.event_type,
            "project_id": payload.project_id,
            "offer_id": payload.offer_id,
            "anonymous_visitor_id": payload.anonymous_visitor_id,
            "session_id": payload.session_id,
            "metadata": payload.metadata,
        }
        # Strip Nones so DB defaults apply where intended
        row = {k: v for k, v in row.items() if v is not None}
        get_client().table("merchant_analytics_events").insert(row).execute()
    except Exception:
        # Intentional: never raise from an analytics endpoint
        pass

    return {"ok": True}
