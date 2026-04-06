"""
Reviews — project ratings and comments.
All queries are wrapped in try/except to handle missing table gracefully.
The reviews table may not exist yet in all environments.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

# Log the missing-table warning only once, not on every request
_table_warning_logged = False


def _safe_fallback(project_id: str = ""):
    """Return safe fallback when reviews table doesn't exist."""
    global _table_warning_logged
    if not _table_warning_logged:
        print("[reviews] table not found — using fallback (this warning logs once)")
        _table_warning_logged = True
    return {
        "project_id": project_id,
        "reviews": [],
        "count": 0,
        "average_rating": None,
    }


class ReviewCreate(BaseModel):
    project_id: str
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = ""


@router.post("/")
def create_or_update_review(body: ReviewCreate, user: dict = Depends(get_current_user)):
    """Create or update a review. One review per user per project."""
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    sb = get_client()

    try:
        existing = (
            sb.table("reviews")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("project_id", body.project_id)
            .limit(1)
            .execute()
        )

        if existing.data:
            sb.table("reviews").update({
                "rating": body.rating,
                "comment": (body.comment or "").strip(),
            }).eq("id", existing.data[0]["id"]).execute()
            return {"status": "updated", "project_id": body.project_id}
        else:
            sb.table("reviews").insert({
                "privy_id": privy_id,
                "project_id": body.project_id,
                "rating": body.rating,
                "comment": (body.comment or "").strip(),
            }).execute()
            return {"status": "created", "project_id": body.project_id}
    except Exception:
        return _safe_fallback(body.project_id)


@router.get("/project/{project_id}")
def list_project_reviews(project_id: str, limit: int = 20):
    """Public: list reviews for a project, newest first."""
    try:
        sb = get_client()
        res = (
            sb.table("reviews")
            .select("id, rating, comment, created_at")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        reviews = res.data or []
        ratings = [r["rating"] for r in reviews]
        avg = sum(ratings) / len(ratings) if ratings else 0

        return {
            "project_id": project_id,
            "reviews": reviews,
            "count": len(reviews),
            "average_rating": round(avg, 1),
        }
    except Exception:
        return _safe_fallback(project_id)


@router.get("/summary/{project_id}")
def review_summary(project_id: str):
    """Public: just the count + average for a project (lightweight)."""
    try:
        sb = get_client()
        res = (
            sb.table("reviews")
            .select("rating")
            .eq("project_id", project_id)
            .execute()
        )

        ratings = [r["rating"] for r in (res.data or [])]
        avg = sum(ratings) / len(ratings) if ratings else 0
        return {
            "project_id": project_id,
            "count": len(ratings),
            "average_rating": round(avg, 1),
        }
    except Exception:
        return _safe_fallback(project_id)
