"""
Reviews — project ratings and comments.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


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

    # Check if review already exists (upsert)
    existing = (
        sb.table("reviews")
        .select("id")
        .eq("privy_id", privy_id)
        .eq("project_id", body.project_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        # Update
        sb.table("reviews").update({
            "rating": body.rating,
            "comment": (body.comment or "").strip(),
        }).eq("id", existing.data[0]["id"]).execute()
        return {"status": "updated", "project_id": body.project_id}
    else:
        # Insert
        sb.table("reviews").insert({
            "privy_id": privy_id,
            "project_id": body.project_id,
            "rating": body.rating,
            "comment": (body.comment or "").strip(),
        }).execute()
        return {"status": "created", "project_id": body.project_id}


@router.get("/project/{project_id}")
def list_project_reviews(project_id: str, limit: int = 20):
    """Public: list reviews for a project, newest first."""
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


@router.get("/summary/{project_id}")
def review_summary(project_id: str):
    """Public: just the count + average for a project (lightweight)."""
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
