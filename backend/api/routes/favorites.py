"""
Favorites — save / unsave businesses.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


class FavoriteToggle(BaseModel):
    project_id: str


@router.post("/toggle")
def toggle_favorite(body: FavoriteToggle, user: dict = Depends(get_current_user)):
    """Add or remove a project from the user's favorites. Returns new state."""
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    sb = get_client()

    # Check if already favorited
    existing = (
        sb.table("favorites")
        .select("id")
        .eq("privy_id", privy_id)
        .eq("project_id", body.project_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        # Remove
        sb.table("favorites").delete().eq("id", existing.data[0]["id"]).execute()
        return {"favorited": False, "project_id": body.project_id}
    else:
        # Add
        sb.table("favorites").insert({
            "privy_id": privy_id,
            "project_id": body.project_id,
        }).execute()
        return {"favorited": True, "project_id": body.project_id}


@router.get("/mine")
def list_my_favorites(user: dict = Depends(get_current_user)):
    """Return list of project IDs the user has favorited."""
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    sb = get_client()
    res = (
        sb.table("favorites")
        .select("project_id, created_at")
        .eq("privy_id", privy_id)
        .order("created_at", desc=True)
        .execute()
    )
    return {"favorites": res.data or []}


@router.get("/count/{project_id}")
def favorite_count(project_id: str):
    """Public: how many users favorited this project."""
    sb = get_client()
    res = (
        sb.table("favorites")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .execute()
    )
    return {"project_id": project_id, "count": res.count or 0}


@router.get("/check/{project_id}")
def check_favorite(project_id: str, user: dict = Depends(get_current_user)):
    """Check if the current user has favorited a project."""
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

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
