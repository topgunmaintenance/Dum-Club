"""
Service booking: profiles, availability slots, bookings, verification codes.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from api.deps import get_project_owner_or_403, get_verified_user_id
from db.supabase import get_client

router = APIRouter()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sb():
    return get_client()


# ── Service Profile ──────────────────────────────────────────────


class ServiceProfileRequest(BaseModel):
    service_type: str = "remote"
    location: Optional[str] = None
    radius_miles: Optional[int] = None
    timezone: str = "America/New_York"
    duration_minutes: int = 60
    buffer_minutes: int = 15
    price_per_token: float = 1.0
    currency: str = "USD"
    service_description: Optional[str] = None
    is_active: bool = True


@router.post("/api/projects/{project_id}/service-profile")
async def upsert_service_profile(
    project_id: str,
    body: ServiceProfileRequest,
    user_id: str = Depends(get_verified_user_id),
):
    supabase = sb()
    await get_project_owner_or_403(project_id, user_id, supabase)

    data: dict[str, Any] = {
        "project_id": project_id,
        **body.model_dump(),
        "updated_at": now_iso(),
    }

    existing = (
        supabase.table("service_profiles")
        .select("id")
        .eq("project_id", project_id)
        .execute()
    )
    if existing.data:
        res = (
            supabase.table("service_profiles")
            .update(data)
            .eq("project_id", project_id)
            .execute()
        )
    else:
        res = supabase.table("service_profiles").insert(data).execute()

    return (res.data[0] if res.data else {}) or {}


@router.get("/api/projects/{project_id}/service-profile")
async def get_service_profile(project_id: str):
    supabase = sb()
    # Accept slug or UUID — frontend forwards URL param verbatim.
    from api.routes.projects import resolve_project_uuid
    resolved_uuid = resolve_project_uuid(supabase, project_id) or project_id
    res = (
        supabase.table("service_profiles")
        .select("*")
        .eq("project_id", resolved_uuid)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0]


# ── Availability ─────────────────────────────────────────────────


class SlotRequest(BaseModel):
    slots: list[dict[str, Any]]


@router.post("/api/projects/{project_id}/availability")
async def set_availability(
    project_id: str,
    body: SlotRequest,
    user_id: str = Depends(get_verified_user_id),
):
    supabase = sb()
    await get_project_owner_or_403(project_id, user_id, supabase)

    existing = (
        supabase.table("availability_slots")
        .select("*")
        .eq("project_id", project_id)
        .execute()
    )
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for r in existing.data or []:
        by_key[(r["slot_date"], r["slot_time"])] = r

    new_keys: set[tuple[str, str]] = set()
    rows: list[dict[str, Any]] = []
    for s in body.slots:
        key = (s["slot_date"], s["slot_time"])
        new_keys.add(key)
        prev = by_key.get(key)
        rows.append(
            {
                "project_id": project_id,
                "slot_date": s["slot_date"],
                "slot_time": s["slot_time"],
                "is_booked": prev["is_booked"] if prev else False,
                "is_blocked": False,
            }
        )

    res = (
        supabase.table("availability_slots")
        .upsert(rows, on_conflict="project_id,slot_date,slot_time")
        .execute()
    )

    # Remove unbooked slots that are no longer selected (preserve booked rows)
    for r in existing.data or []:
        key = (r["slot_date"], r["slot_time"])
        if key not in new_keys and not r.get("is_booked"):
            supabase.table("availability_slots").delete().eq("id", r["id"]).execute()

    return {"created": len(res.data or [])}


@router.get("/api/projects/{project_id}/availability")
async def get_availability(
    project_id: str,
    user_id: Optional[str] = None,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    supabase = sb()
    today = date.today().isoformat()
    proj = supabase.table("projects").select("owner_id").eq("id", project_id).single().execute()
    if not proj.data:
        raise HTTPException(status_code=404, detail="Project not found")

    resolved_user_id = user_id
    if not resolved_user_id and authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        try:
            auth_result = supabase.auth.get_user(token)
            resolved_user_id = auth_result.user.id if auth_result.user else None
        except Exception:
            resolved_user_id = None

    is_owner = bool(resolved_user_id and proj.data.get("owner_id") == resolved_user_id)

    q = (
        supabase.table("availability_slots")
        .select("*")
        .eq("project_id", project_id)
        .gte("slot_date", today)
    )
    if is_owner:
        res = q.order("slot_date").order("slot_time").execute()
    else:
        res = (
            q.eq("is_booked", False)
            .eq("is_blocked", False)
            .order("slot_date")
            .order("slot_time")
            .execute()
        )
    return res.data or []


# ── Booking ───────────────────────────────────────────────────────


class BookingRequest(BaseModel):
    slot_id: str
    customer_wallet: str
    customer_email: Optional[str] = None
    customer_name: Optional[str] = None
    token_amount: float = 1.0
    notes: Optional[str] = None


@router.post("/api/projects/{project_id}/book")
async def create_booking(project_id: str, body: BookingRequest):
    # Customer-facing online booking is disabled for the MVP. Closing the
    # anonymous-INSERT surface that previously exposed the bookings table.
    # The handler is preserved so existing clients (cached pages, QR codes,
    # external tooling) get a clean 410 instead of a 404 or a write that
    # bypasses RLS — backend service-role writes still bypass RLS at the
    # database level, but this route is no longer a customer entry point.
    # Service-profile / availability GETs and the owner-only management
    # routes continue to work; redemption (/api/verify/*) is unaffected.
    raise HTTPException(
        status_code=410,
        detail=(
            "Online booking is currently unavailable. "
            "Please contact the business directly to schedule."
        ),
    )


@router.get("/api/projects/{project_id}/bookings")
async def get_project_bookings(
    project_id: str,
    user_id: str = Depends(get_verified_user_id),
):
    supabase = sb()
    await get_project_owner_or_403(project_id, user_id, supabase)

    res = (
        supabase.table("bookings")
        .select("*, availability_slots(slot_date, slot_time)")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []


# ── Verify / Redeem ───────────────────────────────────────────────


@router.get("/api/verify/{code}")
async def verify_code(code: str):
    supabase = sb()
    res = (
        supabase.table("bookings")
        .select(
            "*, projects(name, token_symbol), availability_slots(slot_date, slot_time)"
        )
        .eq("redemption_code", code)
        .limit(1)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Code not found")

    return res.data[0]


class MarkUsedRequest(BaseModel):
    code: str


@router.post("/api/verify/mark-used")
async def mark_used(
    body: MarkUsedRequest,
    user_id: str = Depends(get_verified_user_id),
):
    supabase = sb()

    booking = (
        supabase.table("bookings")
        .select("id, status, project_id")
        .eq("redemption_code", body.code)
        .single()
        .execute()
    )

    if not booking.data:
        raise HTTPException(status_code=404, detail="Code not found")

    if booking.data.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Already redeemed")

    proj = (
        supabase.table("projects")
        .select("owner_id")
        .eq("id", booking.data["project_id"])
        .single()
        .execute()
    )
    if not proj.data or proj.data.get("owner_id") != user_id:
        raise HTTPException(status_code=403, detail="Only the project owner can mark complete")

    supabase.table("bookings").update(
        {"status": "completed", "completed_at": now_iso()}
    ).eq("redemption_code", body.code).execute()

    return {"success": True, "status": "completed"}
