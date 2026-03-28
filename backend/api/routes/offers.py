"""
Offers CRUD — structured items available for purchase on a project.
Separate from store_items JSONB (which remains untouched).
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


# ── Models ────────────────────────────────────────────────────

class OfferCreate(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    price_usd: float = Field(gt=0)
    offer_type: str  # 'digital_service' | 'physical_product'
    delivery_info: Optional[str] = None
    token_discount_percent: int = Field(default=0, ge=0, le=100)


class OfferUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price_usd: Optional[float] = Field(default=None, gt=0)
    offer_type: Optional[str] = None
    delivery_info: Optional[str] = None
    token_discount_percent: Optional[int] = Field(default=None, ge=0, le=100)
    is_active: Optional[bool] = None


VALID_OFFER_TYPES = {"digital_service", "physical_product"}


# ── Helpers ───────────────────────────────────────────────────

def _get_project_owner(supabase, project_id: str) -> str:
    """Return owner_id for a project, or raise 404."""
    res = (
        supabase.table("projects")
        .select("owner_id")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return res.data[0].get("owner_id")


def _resolve_privy_to_owner(supabase, privy_id: str) -> Optional[str]:
    """Resolve a Privy ID to the profiles.id (owner UUID)."""
    user_res = (
        supabase.table("users")
        .select("wallet_address")
        .eq("privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not user_res.data:
        return None
    wallet = user_res.data[0].get("wallet_address")
    if not wallet:
        return None
    profile_res = (
        supabase.table("profiles")
        .select("id")
        .eq("wallet_address", wallet)
        .limit(1)
        .execute()
    )
    if not profile_res.data:
        return None
    return profile_res.data[0].get("id")


def _verify_project_owner(supabase, project_id: str, privy_id: str):
    """Raise 403 if the privy user is not the project owner."""
    owner_id = _get_project_owner(supabase, project_id)
    resolved = _resolve_privy_to_owner(supabase, privy_id)
    if resolved != owner_id:
        raise HTTPException(status_code=403, detail="Not the project owner")


# ── Routes ────────────────────────────────────────────────────

@router.post("/create")
async def create_offer(
    body: OfferCreate,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_client()
    privy_id = current_user.get("sub")

    if body.offer_type not in VALID_OFFER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"offer_type must be one of: {', '.join(VALID_OFFER_TYPES)}",
        )

    _verify_project_owner(supabase, body.project_id, privy_id)

    insert = {
        "project_id": body.project_id,
        "title": body.title.strip(),
        "description": (body.description or "").strip() or None,
        "price_usd": float(body.price_usd),
        "offer_type": body.offer_type,
        "delivery_info": (body.delivery_info or "").strip() or None,
        "token_discount_percent": body.token_discount_percent,
        "is_active": True,
    }

    res = supabase.table("offers").insert(insert).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create offer")

    return res.data[0]


@router.get("/{project_id}")
async def list_offers(project_id: str):
    supabase = get_client()

    res = (
        supabase.table("offers")
        .select("*")
        .eq("project_id", project_id)
        .eq("is_active", True)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []


@router.patch("/{offer_id}")
async def update_offer(
    offer_id: str,
    body: OfferUpdate,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_client()
    privy_id = current_user.get("sub")

    # Fetch the offer to find its project
    offer_res = (
        supabase.table("offers")
        .select("id, project_id")
        .eq("id", offer_id)
        .limit(1)
        .execute()
    )
    if not offer_res.data:
        raise HTTPException(status_code=404, detail="Offer not found")

    project_id = offer_res.data[0]["project_id"]
    _verify_project_owner(supabase, project_id, privy_id)

    if body.offer_type and body.offer_type not in VALID_OFFER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"offer_type must be one of: {', '.join(VALID_OFFER_TYPES)}",
        )

    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    supabase.table("offers").update(updates).eq("id", offer_id).execute()

    updated = (
        supabase.table("offers")
        .select("*")
        .eq("id", offer_id)
        .single()
        .execute()
    )
    return updated.data
