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


# ── Business analytics (owner only) ──

@router.get("/analytics")
async def get_business_analytics(current_user: dict = Depends(get_current_user)):
    """Aggregate analytics across all projects owned by the authenticated user."""
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

    # Resolve owner_id from privy_id via users table
    user_res = supabase.table("users").select("wallet_address").eq("privy_id", privy_id).limit(1).execute()
    wallet = user_res.data[0]["wallet_address"] if user_res.data else None

    # Get all projects by this owner (match on privy_id OR wallet-based owner_id)
    projects_query = supabase.table("projects").select(
        "id, title, name, status, view_count, dum_received, created_at"
    ).eq("is_deleted", False)

    # Try privy_id match first
    projects_res = projects_query.eq("privy_id", privy_id).execute()
    project_ids = [p["id"] for p in (projects_res.data or [])]
    projects = projects_res.data or []

    # Also check owner_id match via wallet if we have one
    if wallet:
        # Look up profile id for this wallet
        profile_res = supabase.table("profiles").select("id").eq("wallet_address", wallet).limit(1).execute()
        if profile_res.data:
            profile_id = profile_res.data[0]["id"]
            owner_projects = (
                supabase.table("projects")
                .select("id, title, name, status, view_count, dum_received, created_at")
                .eq("owner_id", profile_id)
                .eq("is_deleted", False)
                .execute()
            )
            for p in (owner_projects.data or []):
                if p["id"] not in project_ids:
                    project_ids.append(p["id"])
                    projects.append(p)

    if not project_ids:
        return {
            "total_projects": 0,
            "live_projects": 0,
            "total_views": 0,
            "total_orders": 0,
            "total_revenue_usd": 0,
            "total_dum_received": 0,
            "dum_discount_orders": 0,
            "projects": [],
            "top_offers": [],
            "recent_orders": [],
        }

    # Aggregate project-level metrics
    total_views = sum(p.get("view_count", 0) or 0 for p in projects)
    total_dum_received = sum(p.get("dum_received", 0) or 0 for p in projects)
    live_projects = sum(1 for p in projects if p.get("status") == "live")

    # Get orders for all projects
    orders = []
    for pid in project_ids:
        order_res = (
            supabase.table("orders")
            .select("id, amount_paid_usd, status, token_discount_applied, created_at, offers(title)")
            .eq("project_id", pid)
            .execute()
        )
        for o in (order_res.data or []):
            o["project_id"] = pid
            orders.append(o)

    paid_orders = [o for o in orders if o.get("status") in ("paid", "fulfilled", "delivered")]
    total_revenue = sum(float(o.get("amount_paid_usd", 0) or 0) for o in paid_orders)
    dum_discount_orders = sum(1 for o in paid_orders if o.get("token_discount_applied"))

    # Get offers with quantity_sold for top-performing
    all_offers = []
    for pid in project_ids:
        offer_res = (
            supabase.table("offers")
            .select("id, title, price_usd, quantity_sold, is_active, project_id")
            .eq("project_id", pid)
            .execute()
        )
        all_offers.extend(offer_res.data or [])

    top_offers = sorted(all_offers, key=lambda o: o.get("quantity_sold", 0) or 0, reverse=True)[:5]

    # Recent orders (last 10)
    recent_orders = sorted(paid_orders, key=lambda o: o.get("created_at", ""), reverse=True)[:10]

    # Per-project summary
    project_summaries = []
    for p in projects:
        pid = p["id"]
        p_orders = [o for o in paid_orders if o.get("project_id") == pid]
        p_revenue = sum(float(o.get("amount_paid_usd", 0) or 0) for o in p_orders)
        project_summaries.append({
            "id": pid,
            "title": p.get("title") or p.get("name") or "Untitled",
            "status": p.get("status", "draft"),
            "views": p.get("view_count", 0) or 0,
            "orders": len(p_orders),
            "revenue_usd": round(p_revenue, 2),
            "dum_received": p.get("dum_received", 0) or 0,
        })

    # Sort projects by revenue descending
    project_summaries.sort(key=lambda p: p["revenue_usd"], reverse=True)

    return {
        "total_projects": len(projects),
        "live_projects": live_projects,
        "total_views": total_views,
        "total_orders": len(paid_orders),
        "total_revenue_usd": round(total_revenue, 2),
        "total_dum_received": total_dum_received,
        "dum_discount_orders": dum_discount_orders,
        "projects": project_summaries,
        "top_offers": top_offers,
        "recent_orders": [
            {
                "id": o["id"],
                "amount": float(o.get("amount_paid_usd", 0) or 0),
                "offer_title": (o.get("offers") or {}).get("title", "Unknown"),
                "dum_discount": bool(o.get("token_discount_applied")),
                "date": o.get("created_at"),
            }
            for o in recent_orders
        ],
    }


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
