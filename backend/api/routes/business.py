"""
Business Profiles API — create, read, update, verify.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


class BusinessProfileCreate(BaseModel):
    business_name: str
    category: str = "General"
    short_description: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None
    contact_email: Optional[str] = None


class BusinessProfileUpdate(BaseModel):
    business_name: Optional[str] = None
    category: Optional[str] = None
    short_description: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None
    contact_email: Optional[str] = None


class VerificationRequest(BaseModel):
    website: Optional[str] = None
    contact_email: Optional[str] = None
    note: Optional[str] = None


# ── Get my business profile ──

@router.get("/me")
async def get_my_business(current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()
    res = (
        supabase.table("business_profiles")
        .select("*")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return {"profile": None}
    return {"profile": res.data[0]}


# ── Get business profile by owner privy_id (public, limited fields) ──

@router.get("/by-owner/{owner_privy_id}")
async def get_business_by_owner(owner_privy_id: str):
    supabase = get_client()
    res = (
        supabase.table("business_profiles")
        .select("id, business_name, category, short_description, logo_url, website, verification_status, created_at")
        .eq("owner_privy_id", owner_privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return {"profile": None}
    return {"profile": res.data[0]}


# ── Get business profile by ID (public) ──

@router.get("/{business_id}")
async def get_business(business_id: str):
    supabase = get_client()
    res = (
        supabase.table("business_profiles")
        .select("id, business_name, category, short_description, logo_url, website, verification_status, created_at")
        .eq("id", business_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Business not found")
    return {"profile": res.data[0]}


# ── Create business profile ──

@router.post("/create")
async def create_business(
    body: BusinessProfileCreate,
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    if not body.business_name or not body.business_name.strip():
        raise HTTPException(status_code=400, detail="Business name is required")

    supabase = get_client()

    # Check if user already has a business profile
    existing = (
        supabase.table("business_profiles")
        .select("id")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=400, detail="You already have a business profile")

    payload = {
        "owner_privy_id": privy_id,
        "business_name": body.business_name.strip(),
        "category": body.category or "General",
        "short_description": (body.short_description or "").strip() or None,
        "logo_url": (body.logo_url or "").strip() or None,
        "website": (body.website or "").strip() or None,
        "contact_email": (body.contact_email or "").strip() or None,
        "verification_status": "unverified",
    }

    res = supabase.table("business_profiles").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create business profile")

    print(f"[business] created profile for {privy_id}: {body.business_name}")
    return {"profile": res.data[0]}


# ── Update business profile ──

@router.patch("/update")
async def update_business(
    body: BusinessProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

    existing = (
        supabase.table("business_profiles")
        .select("id")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="No business profile found")

    biz_id = existing.data[0]["id"]
    updates = {}
    if body.business_name is not None:
        updates["business_name"] = body.business_name.strip()
    if body.category is not None:
        updates["category"] = body.category
    if body.short_description is not None:
        updates["short_description"] = body.short_description.strip() or None
    if body.logo_url is not None:
        updates["logo_url"] = body.logo_url.strip() or None
    if body.website is not None:
        updates["website"] = body.website.strip() or None
    if body.contact_email is not None:
        updates["contact_email"] = body.contact_email.strip() or None

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = "now()"

    supabase.table("business_profiles").update(updates).eq("id", biz_id).execute()
    print(f"[business] updated profile {biz_id}")

    refreshed = supabase.table("business_profiles").select("*").eq("id", biz_id).limit(1).execute()
    return {"profile": refreshed.data[0] if refreshed.data else None}


# ── Request verification ──

@router.post("/request-verification")
async def request_verification(
    body: VerificationRequest,
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

    existing = (
        supabase.table("business_profiles")
        .select("id, verification_status")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="No business profile found")

    biz = existing.data[0]
    if biz["verification_status"] == "verified":
        return {"status": "already_verified", "profile": biz}
    if biz["verification_status"] == "pending":
        return {"status": "already_pending", "profile": biz}

    updates = {"verification_status": "pending", "updated_at": "now()"}
    if body.website:
        updates["website"] = body.website.strip()
    if body.contact_email:
        updates["contact_email"] = body.contact_email.strip()
    if body.note:
        updates["verification_note"] = body.note.strip()

    supabase.table("business_profiles").update(updates).eq("id", biz["id"]).execute()
    print(f"[business] verification requested for {biz['id']}")

    refreshed = supabase.table("business_profiles").select("*").eq("id", biz["id"]).limit(1).execute()
    return {"status": "pending", "profile": refreshed.data[0] if refreshed.data else None}
