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
    cover_image_url: Optional[str] = None
    website: Optional[str] = None
    contact_email: Optional[str] = None


class BusinessProfileUpdate(BaseModel):
    business_name: Optional[str] = None
    category: Optional[str] = None
    short_description: Optional[str] = None
    logo_url: Optional[str] = None
    cover_image_url: Optional[str] = None
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

    # ── Drive Your Market Analytics — funnel + visitor metrics ──
    # Additive fields. Existing dashboard tiles read the legacy fields;
    # the new <DriveYourMarketAnalytics /> tile reads these. Best-effort
    # — if the events table or any query fails, we return zeros so the
    # base analytics response is never broken by the new feature.
    funnel = _drive_your_market_funnel(supabase, project_ids, paid_orders)

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
        # ── Drive Your Market Analytics — additive ──
        "drive_your_market": funnel,
    }


def _drive_your_market_funnel(supabase, project_ids: list, paid_orders: list) -> dict:
    """
    Compute the Drive Your Market funnel for the merchant's projects.

    Returns visitor / view / checkout / repeat-customer metrics + a
    7d / 30d windowed view. All best-effort: any query failure yields
    a zero-filled funnel so the parent endpoint never breaks.

    Repeat customers come from `orders.buyer_user_id` (Privy ID),
    which is already populated for every paid Stripe order — no events
    table read needed.
    """
    zero = {
        "embed_views": 0,
        "project_views": 0,
        "offer_views": 0,
        "unique_visitors": 0,
        "returning_visitors": 0,
        "checkout_starts": 0,
        "purchases": len(paid_orders),
        "conversion_rate": 0.0,
        "repeat_customers": 0,
        "best_offer": None,
        "window_7d": {"visitors": 0, "purchases": 0, "revenue_usd": 0.0},
        "window_30d": {"visitors": 0, "purchases": 0, "revenue_usd": 0.0},
    }
    if not project_ids:
        return zero

    try:
        # Pull recent events (cap at 10k rows — covers most merchants and
        # avoids unbounded memory on a busy storefront)
        ev_res = (
            supabase.table("merchant_analytics_events")
            .select("event_type, anonymous_visitor_id, offer_id, created_at, project_id")
            .in_("project_id", project_ids)
            .order("created_at", desc=True)
            .limit(10000)
            .execute()
        )
        events = ev_res.data or []
    except Exception:
        return zero

    from collections import Counter
    from datetime import datetime, timedelta, timezone

    by_type: Counter = Counter()
    visitors_by_type: dict[str, set] = {"embed_view": set(), "project_view": set()}
    visitor_visit_count: Counter = Counter()
    offer_view_counts: Counter = Counter()

    for e in events:
        et = e.get("event_type")
        vid = e.get("anonymous_visitor_id")
        by_type[et] += 1
        if et in visitors_by_type and vid:
            visitors_by_type[et].add(vid)
        if vid:
            visitor_visit_count[vid] += 1
        if et == "offer_view" and e.get("offer_id"):
            offer_view_counts[e["offer_id"]] += 1

    unique_visitors = len(visitors_by_type["project_view"] | visitors_by_type["embed_view"])
    returning_visitors = sum(1 for c in visitor_visit_count.values() if c > 1)
    checkout_starts = by_type.get("checkout_start", 0)
    purchases = len(paid_orders)
    conversion_rate = (
        round((purchases / unique_visitors) * 100.0, 2) if unique_visitors else 0.0
    )

    # Best-performing offer by views (fall back to offers table for title)
    best_offer = None
    if offer_view_counts:
        top_offer_id, top_views = offer_view_counts.most_common(1)[0]
        try:
            t_res = (
                supabase.table("offers")
                .select("id, title")
                .eq("id", top_offer_id)
                .limit(1)
                .execute()
            )
            title = (t_res.data[0]["title"] if t_res.data else None) or "Untitled"
            best_offer = {"id": top_offer_id, "title": title, "views": top_views}
        except Exception:
            best_offer = {"id": top_offer_id, "title": "Untitled", "views": top_views}

    # 7d / 30d windows
    now = datetime.now(timezone.utc)
    cutoff_7d = now - timedelta(days=7)
    cutoff_30d = now - timedelta(days=30)

    def _parse(ts: str | None):
        if not ts:
            return None
        try:
            # Supabase returns ISO strings
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None

    visitors_7d: set = set()
    visitors_30d: set = set()
    for e in events:
        et = e.get("event_type")
        vid = e.get("anonymous_visitor_id")
        if et not in ("project_view", "embed_view") or not vid:
            continue
        ts = _parse(e.get("created_at"))
        if not ts:
            continue
        if ts >= cutoff_7d:
            visitors_7d.add(vid)
        if ts >= cutoff_30d:
            visitors_30d.add(vid)

    purchases_7d = 0
    purchases_30d = 0
    revenue_7d = 0.0
    revenue_30d = 0.0
    for o in paid_orders:
        ts = _parse(o.get("created_at"))
        if not ts:
            continue
        amt = float(o.get("amount_paid_usd", 0) or 0)
        if ts >= cutoff_7d:
            purchases_7d += 1
            revenue_7d += amt
        if ts >= cutoff_30d:
            purchases_30d += 1
            revenue_30d += amt

    # Repeat customers — from orders, not events (every paid order has
    # buyer_user_id). Count buyers with > 1 paid order on this merchant's
    # projects.
    buyer_counts: Counter = Counter()
    for o in paid_orders:
        buyer = o.get("buyer_user_id")
        if buyer:
            buyer_counts[buyer] += 1
    repeat_customers = sum(1 for c in buyer_counts.values() if c > 1)

    return {
        "embed_views": by_type.get("embed_view", 0),
        "project_views": by_type.get("project_view", 0),
        "offer_views": by_type.get("offer_view", 0),
        "unique_visitors": unique_visitors,
        "returning_visitors": returning_visitors,
        "checkout_starts": checkout_starts,
        "purchases": purchases,
        "conversion_rate": conversion_rate,
        "repeat_customers": repeat_customers,
        "best_offer": best_offer,
        "window_7d": {
            "visitors": len(visitors_7d),
            "purchases": purchases_7d,
            "revenue_usd": round(revenue_7d, 2),
        },
        "window_30d": {
            "visitors": len(visitors_30d),
            "purchases": purchases_30d,
            "revenue_usd": round(revenue_30d, 2),
        },
    }


# ── Get business profile by owner privy_id (public, limited fields) ──

@router.get("/by-owner/{owner_privy_id}")
async def get_business_by_owner(owner_privy_id: str):
    supabase = get_client()
    res = (
        supabase.table("business_profiles")
        .select("id, business_name, category, short_description, logo_url, cover_image_url, website, verification_status, created_at")
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
        .select("id, business_name, category, short_description, logo_url, cover_image_url, website, verification_status, created_at")
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
        "cover_image_url": (body.cover_image_url or "").strip() or None,
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
    if body.cover_image_url is not None:
        updates["cover_image_url"] = body.cover_image_url.strip() or None
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
