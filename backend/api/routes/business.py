"""
Business Profiles API — create, read, update, verify.
"""

from __future__ import annotations

import asyncio
import os
import re
import time

import stripe
from fastapi import APIRouter, File, Form, HTTPException, Depends, Query, UploadFile
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


# Curated MCC (Stripe merchant category code) -> create-business form
# category. Covers the common ranges a small local business reports;
# anything unmapped falls back to "General". Partial mapping is fine —
# the merchant edits the prefilled value before saving.
_MCC_TO_CATEGORY = {
    # Food & Beverage
    "5811": "Food & Beverage", "5812": "Food & Beverage", "5813": "Food & Beverage",
    "5814": "Food & Beverage", "5499": "Food & Beverage", "5462": "Food & Beverage",
    "5451": "Food & Beverage", "5411": "Food & Beverage",
    # Retail
    "5311": "Retail", "5300": "Retail", "5331": "Retail", "5399": "Retail",
    "5999": "Retail", "5912": "Retail", "5942": "Retail", "5651": "Retail",
    "5691": "Retail", "5944": "Retail",
    # Technology
    "5732": "Technology", "5734": "Technology", "5045": "Technology",
    "7372": "Technology", "7379": "Technology",
    # Health & Fitness
    "8011": "Health & Fitness", "8021": "Health & Fitness", "8031": "Health & Fitness",
    "8049": "Health & Fitness", "8062": "Health & Fitness", "8099": "Health & Fitness",
    "7298": "Health & Fitness", "7997": "Health & Fitness",
    # Creative
    "7333": "Creative", "7929": "Creative", "5970": "Creative", "7221": "Creative",
    "7338": "Creative",
    # Education
    "8211": "Education", "8220": "Education", "8241": "Education", "8244": "Education",
    "8249": "Education", "8299": "Education",
    # Gaming
    "7994": "Gaming", "7993": "Gaming",
    # Services
    "7299": "Services", "7392": "Services", "7349": "Services", "1520": "Services",
    "1711": "Services", "7538": "Services", "7531": "Services", "7549": "Services",
    "4121": "Services", "7230": "Services", "7211": "Services",
}


def _stripe_attr(obj, key):
    """Read a key from a Stripe object or dict, returning None when absent."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _resolve_owned_business(supabase, privy_id: str, business_id: Optional[str]) -> dict:
    """Resolve the caller's business profile, scoped by an optional
    business_id (multi-business STEP 1.5).

    - business_id given: match on id AND owner_privy_id, so a non-owner's
      id never resolves (fail-closed — 404, never admit a non-owner).
    - business_id omitted: the owner's first/only business
      (ORDER BY created_at), preserving single-business behavior exactly.

    Raises 404 when nothing matches.
    """
    q = (
        supabase.table("business_profiles")
        .select("*")
        .eq("owner_privy_id", privy_id)
    )
    if business_id:
        q = q.eq("id", business_id)
    rows = q.order("created_at").limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Business not found")
    return rows[0]


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
async def get_my_business(
    business_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()
    # Scope to the chosen business when business_id is given; otherwise the
    # owner's first/only business (single-business behavior unchanged).
    q = (
        supabase.table("business_profiles")
        .select("*")
        .eq("owner_privy_id", privy_id)
    )
    if business_id:
        q = q.eq("id", business_id)
    res = q.order("created_at").limit(1).execute()
    if not res.data:
        return {"profile": None}
    return {"profile": res.data[0]}


# ── List all my business profiles (multi-business switcher) ──

@router.get("/list")
async def list_my_businesses(current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()
    res = (
        supabase.table("business_profiles")
        .select("id, business_name, category, logo_url, cover_image_url, verification_status, created_at")
        .eq("owner_privy_id", privy_id)
        .order("created_at")
        .execute()
    )
    return {"businesses": res.data or []}


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
    name = body.business_name.strip()

    # Multi-business (migration 075): an owner may hold many DISTINCT
    # businesses. The old one-per-owner block is replaced with a
    # same-name dedupe — a double-tap can't create two identical rows,
    # but distinct names are allowed. Case-insensitive match.
    dupe = (
        supabase.table("business_profiles")
        .select("id")
        .eq("owner_privy_id", privy_id)
        .ilike("business_name", name)
        .limit(1)
        .execute()
    )
    if dupe.data:
        raise HTTPException(status_code=409, detail="You already have a business with that name.")

    payload = {
        "owner_privy_id": privy_id,
        # privy_id is NOT NULL on the live table; the prior payload missed
        # it, which is why the raw INSERT crashed (CORS-stripped 500).
        # Populated from the session DID, same value as owner_privy_id.
        "privy_id": privy_id,
        "business_name": name,
        "category": body.category or "General",
        "short_description": (body.short_description or "").strip() or None,
        "logo_url": (body.logo_url or "").strip() or None,
        "cover_image_url": (body.cover_image_url or "").strip() or None,
        "website": (body.website or "").strip() or None,
        "contact_email": (body.contact_email or "").strip() or None,
        "verification_status": "unverified",
        # project_id intentionally omitted → NULL (migration 075 relaxed
        # the NOT NULL). A storefront links itself to this business later
        # via projects.business_profile_id.
    }

    # Wrap the INSERT so a constraint violation returns a clean 4xx/5xx
    # that flows back through the CORS middleware with ACAO intact —
    # never an uncaught raw 500 that strips CORS and shows the visitor a
    # "Failed to fetch". Same hardening pattern as PR #361/#362/#379.
    try:
        res = supabase.table("business_profiles").insert(payload).execute()
    except Exception as exc:
        msg = str(exc).lower()
        if "duplicate key" in msg or "23505" in msg:
            raise HTTPException(status_code=409, detail="You already have a business with that name.")
        print(f"[business] create failed for {privy_id}: {exc!r}")
        raise HTTPException(status_code=500, detail="Couldn't create your business right now. Try again in a moment.")
    if not res.data:
        raise HTTPException(status_code=500, detail="Couldn't create your business right now. Try again in a moment.")

    print(f"[business] created profile for {privy_id}: {name}")
    return {"profile": res.data[0]}


# ── Stripe Connect prefill (read-only) ──

@router.get("/stripe-prefill")
async def stripe_prefill(current_user: dict = Depends(get_current_user)):
    """Read-only business-identity suggestions from the caller's connected
    Stripe account, so creating a business profile becomes photos-only.

    Additive + read-only: NO merchants/business_profiles write, NO schema.
    Owner-scoped (the authenticated caller's own merchant row) — a caller
    can never read another owner's Stripe data. Returns {connected:false}
    (never an error leak) when there's no connected Stripe or the lookup
    fails. The frontend prefills only EMPTY form fields, non-destructively.

    Returns: {connected: bool, status: str|None, suggested: {...}}
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()
    m = (
        supabase.table("merchants")
        .select("stripe_connect_id")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    connect_id = m.data[0].get("stripe_connect_id") if m.data else None
    if not connect_id:
        return {"connected": False, "status": None, "suggested": {}}

    secret = os.getenv("STRIPE_SECRET_KEY", "").strip()
    if not secret:
        return {"connected": False, "status": None, "suggested": {}}
    stripe.api_key = secret

    try:
        account = await asyncio.run_in_executor(
            None, stripe.Account.retrieve, connect_id
        )
    except Exception as exc:
        # Fail-closed: never surface a raw error; the form just stays blank.
        print(f"[business] stripe-prefill Account.retrieve failed for {connect_id}: {type(exc).__name__}")
        return {"connected": False, "status": None, "suggested": {}}

    bp = _stripe_attr(account, "business_profile") or {}
    settings = _stripe_attr(account, "settings")
    dashboard = _stripe_attr(settings, "dashboard")
    company = _stripe_attr(account, "company")
    individual = _stripe_attr(account, "individual")

    # business_name fallback chain.
    name = (
        _stripe_attr(bp, "name")
        or _stripe_attr(dashboard, "display_name")
        or _stripe_attr(company, "name")
    )
    if not name and individual is not None:
        fn = _stripe_attr(individual, "first_name") or ""
        ln = _stripe_attr(individual, "last_name") or ""
        name = (f"{fn} {ln}").strip() or None

    contact_email = _stripe_attr(bp, "support_email") or _stripe_attr(account, "email")
    website = _stripe_attr(bp, "url")
    short_description = _stripe_attr(bp, "product_description")
    mcc = _stripe_attr(bp, "mcc")
    category = _MCC_TO_CATEGORY.get(str(mcc), "General") if mcc else "General"

    # Derived status (read-only mirror of the status endpoint's logic).
    charges = bool(_stripe_attr(account, "charges_enabled"))
    payouts = bool(_stripe_attr(account, "payouts_enabled"))
    details = bool(_stripe_attr(account, "details_submitted"))
    if charges and payouts and details:
        status = "verified"
    elif details:
        status = "pending_verification"
    else:
        status = "connected"

    return {
        "connected": True,
        "status": status,
        "suggested": {
            "business_name": name or "",
            "contact_email": contact_email or "",
            "website": website or "",
            "short_description": short_description or "",
            "category": category,
        },
    }


# ── Update business profile ──

@router.patch("/update")
async def update_business(
    body: BusinessProfileUpdate,
    business_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

    # Scope to the chosen business (fail-closed); default to first/only.
    biz_id = _resolve_owned_business(supabase, privy_id, business_id)["id"]
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
    business_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

    # Scope to the chosen business (fail-closed); default to first/only.
    biz = _resolve_owned_business(supabase, privy_id, business_id)
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


# ─────────────────────────────────────────────────────────────────────
# Server-mediated image upload — Path 2 hardening sprint PR 1.
#
# Receives the merchant's logo / cover image via multipart, validates
# size + MIME + ownership server-side, then writes to Supabase Storage
# using the SUPABASE_SERVICE_KEY client (BYPASSRLS). Replaces the
# browser-direct upload at frontend/components/dashboard/
# MerchantImageUploader.tsx in a subsequent frontend swap PR.
#
# Until that swap lands, BOTH paths coexist — the frontend keeps
# writing via the anon-key client through the existing wide-open
# storage policy. This endpoint is additive only.
#
# Mirrors transcribe.py's UploadFile + size-guard shape.
# ─────────────────────────────────────────────────────────────────────


_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB — matches MerchantImageUploader.MAX_BYTES
_VALID_BUSINESS_SLOTS = ("logo", "cover")
_EXT_RE = re.compile(r"^[a-z0-9]{1,5}$")


def _safe_extension(filename: Optional[str], default: str = "jpg") -> str:
    """Extract a safe lowercase extension from an UploadFile.filename.

    Avoids letting a forged filename inject path traversal / weird
    characters into the storage key. Mirrors the validation the
    browser-direct upload sites already do client-side.
    """
    if not filename or "." not in filename:
        return default
    ext = filename.rsplit(".", 1)[-1].lower().strip()
    return ext if _EXT_RE.match(ext) else default


@router.post("/upload-image")
async def upload_business_image(
    slot: str = Form(...),
    file: UploadFile = File(...),
    business_id: Optional[str] = Form(None),
    current_user: dict = Depends(get_current_user),
):
    """Server-mediated logo / cover image upload.

    Form fields:
      slot: 'logo' | 'cover'
      file: multipart image (image/*, ≤ 5 MB)

    Mirrors the storage layout the browser-direct upload at
    MerchantImageUploader.tsx writes today, so PATCH /api/business/update
    consumes the returned public_url unchanged.

    Returns: {"public_url": str, "path": str}
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    if slot not in _VALID_BUSINESS_SLOTS:
        raise HTTPException(
            status_code=400,
            detail=f"slot must be one of: {', '.join(_VALID_BUSINESS_SLOTS)}",
        )

    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="File must be an image (JPEG, PNG, WebP, GIF).",
        )

    contents = await file.read()
    if len(contents) > _MAX_IMAGE_BYTES:
        size_mb = len(contents) / 1024 / 1024
        raise HTTPException(
            status_code=413,
            detail=f"File is too large ({size_mb:.1f}MB). Max 5MB.",
        )

    supabase = get_client()

    # Resolve the target business, scoped by business_id (fail-closed);
    # default to the owner's first/only business. The storage path is
    # keyed on biz_id below, so the upload lands under the chosen brand.
    biz_id = _resolve_owned_business(supabase, privy_id, business_id)["id"]

    ext = _safe_extension(file.filename)
    path = f"business-images/{biz_id}/{slot}-{int(time.time() * 1000)}.{ext}"

    try:
        supabase.storage.from_("offers").upload(
            path=path,
            file=contents,
            file_options={
                "content-type": content_type,
                "cache-control": "3600",
                "upsert": "false",
            },
        )
    except Exception as exc:
        print(f"[upload] business image upload failed for biz={biz_id}: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail="Upload failed. Try again.")

    public_url = supabase.storage.from_("offers").get_public_url(path)

    return {"public_url": public_url, "path": path}
