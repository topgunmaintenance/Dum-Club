"""
Category follows — "follow a category, get pinged when a shop in it goes live".

Mirrors favorites.py: every query is wrapped in try/except so the API stays
up even before the category_follows table exists (hand-applied migration).
Until the table lands, every endpoint is a safe no-op.

Storage: (privy_id, category) unique. We also snapshot the follower's email so
the go-live notifier (services.agents.live_reminders.notify_category_followers)
can email them directly without a privy -> email lookup — the same shape the
live-reminders flow uses.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

_warned = False


def _log_once():
    global _warned
    if not _warned:
        print("[category-follows] table not found — using fallback (logs once)")
        _warned = True


class CategoryToggle(BaseModel):
    category: str
    email: Optional[str] = None


@router.post("/toggle")
def toggle_category(body: CategoryToggle, user: dict = Depends(get_current_user)):
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    category = (body.category or "").strip().lower()
    if not category:
        raise HTTPException(status_code=400, detail="category required")

    try:
        sb = get_client()
        existing = (
            sb.table("category_follows")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("category", category)
            .limit(1)
            .execute()
        )
        if existing.data:
            sb.table("category_follows").delete().eq("id", existing.data[0]["id"]).execute()
            return {"following": False, "category": category}
        sb.table("category_follows").insert({
            "privy_id": privy_id,
            "email": (body.email or "").strip().lower() or None,
            "category": category,
        }).execute()
        return {"following": True, "category": category}
    except Exception:
        _log_once()
        return {"following": False, "category": category}


@router.get("/mine")
def list_my_categories(user: dict = Depends(get_current_user)):
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        sb = get_client()
        res = (
            sb.table("category_follows")
            .select("category")
            .eq("privy_id", privy_id)
            .execute()
        )
        return {"categories": [r["category"] for r in (res.data or []) if r.get("category")]}
    except Exception:
        _log_once()
        return {"categories": []}


@router.get("/check/{category}")
def check_category(category: str, user: dict = Depends(get_current_user)):
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        sb = get_client()
        res = (
            sb.table("category_follows")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("category", (category or "").strip().lower())
            .limit(1)
            .execute()
        )
        return {"following": bool(res.data), "category": category}
    except Exception:
        _log_once()
        return {"following": False, "category": category}
