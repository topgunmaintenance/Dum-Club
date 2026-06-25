"""
Favorites — save / unsave businesses.
All queries wrapped in try/except for missing table safety.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

_table_warning_logged = False


def _log_once():
    global _table_warning_logged
    if not _table_warning_logged:
        print("[favorites] table not found — using fallback (this warning logs once)")
        _table_warning_logged = True


class FavoriteToggle(BaseModel):
    project_id: str


@router.post("/toggle")
def toggle_favorite(body: FavoriteToggle, user: dict = Depends(get_current_user)):
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        sb = get_client()
        existing = (
            sb.table("favorites")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("project_id", body.project_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            sb.table("favorites").delete().eq("id", existing.data[0]["id"]).execute()
            return {"favorited": False, "project_id": body.project_id}
        else:
            sb.table("favorites").insert({
                "privy_id": privy_id,
                "project_id": body.project_id,
            }).execute()
            return {"favorited": True, "project_id": body.project_id}
    except Exception:
        _log_once()
        return {"favorited": False, "project_id": body.project_id}


@router.get("/mine")
def list_my_favorites(user: dict = Depends(get_current_user)):
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        sb = get_client()
        res = (
            sb.table("favorites")
            .select("project_id, created_at")
            .eq("privy_id", privy_id)
            .order("created_at", desc=True)
            .execute()
        )
        return {"favorites": res.data or []}
    except Exception:
        _log_once()
        return {"favorites": []}


@router.get("/count/{project_id}")
def favorite_count(project_id: str):
    try:
        sb = get_client()
        res = (
            sb.table("favorites")
            .select("id", count="exact")
            .eq("project_id", project_id)
            .execute()
        )
        return {"project_id": project_id, "count": res.count or 0}
    except Exception:
        _log_once()
        return {"project_id": project_id, "count": 0}


class FavoriteCounts(BaseModel):
    project_ids: list[str]


@router.post("/counts")
def favorite_counts(body: FavoriteCounts):
    """Follower counts for many projects in one request (the Discover grid).
    Counts in Python since PostgREST has no group-by; capped + best-effort."""
    ids = [i for i in (body.project_ids or []) if i][:300]
    if not ids:
        return {"counts": {}}
    try:
        sb = get_client()
        res = sb.table("favorites").select("project_id").in_("project_id", ids).execute()
        counts: dict[str, int] = {}
        for row in (res.data or []):
            pid = row.get("project_id")
            if pid:
                counts[pid] = counts.get(pid, 0) + 1
        return {"counts": counts}
    except Exception:
        _log_once()
        return {"counts": {}}


@router.get("/check/{project_id}")
def check_favorite(project_id: str, user: dict = Depends(get_current_user)):
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        sb = get_client()
        res = (
            sb.table("favorites")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("project_id", project_id)
            .limit(1)
            .execute()
        )
        return {"favorited": bool(res.data), "project_id": project_id}
    except Exception:
        _log_once()
        return {"favorited": False, "project_id": project_id}
