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


def _resolve_uuid(sb, project_id: str) -> str:
    """Resolve a slug-or-UUID to the canonical project UUID, or return the
    original on miss (preserves the prior empty-on-unknown behavior)."""
    try:
        from api.routes.projects import resolve_project_uuid
        return resolve_project_uuid(sb, project_id) or project_id
    except Exception:
        return project_id


def _is_project_owner(sb, project_uuid: str, privy_id: str) -> bool:
    """True when privy_id owns the project. Ownership resolves via
    projects.privy_id, or business_profiles.owner_privy_id joined through
    projects.business_profile_id (the canonical merchant link)."""
    try:
        prow = (
            sb.table("projects")
            .select("privy_id, business_profile_id")
            .eq("id", project_uuid)
            .limit(1)
            .execute()
        )
        if not prow.data:
            return False
        project = prow.data[0]
        if project.get("privy_id") and project["privy_id"] == privy_id:
            return True
        bp_id = project.get("business_profile_id")
        if bp_id:
            bres = (
                sb.table("business_profiles")
                .select("owner_privy_id")
                .eq("id", bp_id)
                .limit(1)
                .execute()
            )
            if bres.data and bres.data[0].get("owner_privy_id") == privy_id:
                return True
    except Exception as exc:  # noqa: BLE001
        # Fail-closed for the owner check: if we cannot determine ownership
        # we treat the caller as a potential owner and block the review,
        # rather than risk letting an owner self-review.
        print(f"[reviews] owner check failed for project={project_uuid}: {exc!r}")
        return True
    return False


class ReviewCreate(BaseModel):
    project_id: str
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = Field(default="", max_length=2000)


@router.post("/")
def create_or_update_review(body: ReviewCreate, user: dict = Depends(get_current_user)):
    """Create or update a review. One review per reviewer per storefront
    (enforced by the reviews UNIQUE(privy_id, project_id) constraint).
    Owners cannot review their own project. Fail-closed: genuine DB errors
    surface as 5xx, never a fake-success fallback."""
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    sb = get_client()
    project_uuid = _resolve_uuid(sb, body.project_id)

    # Owners cannot review their own storefront.
    if _is_project_owner(sb, project_uuid, privy_id):
        raise HTTPException(status_code=403, detail="You can't review your own storefront.")

    comment = (body.comment or "").strip()
    if len(comment) > 2000:
        raise HTTPException(status_code=400, detail="Review is too long (2000 characters max).")

    try:
        existing = (
            sb.table("reviews")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("project_id", project_uuid)
            .limit(1)
            .execute()
        )

        if existing.data:
            sb.table("reviews").update({
                "rating": body.rating,
                "comment": comment,
            }).eq("id", existing.data[0]["id"]).execute()
            return {"status": "updated", "project_id": project_uuid}

        sb.table("reviews").insert({
            "privy_id": privy_id,
            "project_id": project_uuid,
            "rating": body.rating,
            "comment": comment,
        }).execute()
        return {"status": "created", "project_id": project_uuid}
    except Exception as exc:  # noqa: BLE001
        msg = f"{getattr(exc, 'code', '')} {exc}".lower()
        # A unique-violation means a review was created concurrently (the
        # UNIQUE(privy_id, project_id) constraint did its job). Treat as a
        # successful one-per-project outcome rather than a 500.
        if "23505" in msg or "duplicate" in msg or "unique" in msg:
            return {"status": "exists", "project_id": project_uuid}
        print(f"[reviews] POST failed project={project_uuid}: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="We couldn't save your review right now. Please try again in a moment.",
        )


@router.get("/project/{project_id}")
def list_project_reviews(project_id: str, limit: int = 20, offset: int = 0):
    """Public: paginated list of reviews for a project, newest first. The
    count + average are computed over ALL reviews (not just the page) via a
    lightweight ratings-only read-time aggregate."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    try:
        sb = get_client()
        project_uuid = _resolve_uuid(sb, project_id)
        res = (
            sb.table("reviews")
            .select("id, rating, comment, created_at")
            .eq("project_id", project_uuid)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        # Accurate aggregate over the FULL set, not the page.
        agg = (
            sb.table("reviews")
            .select("rating")
            .eq("project_id", project_uuid)
            .execute()
        )
        ratings = [r["rating"] for r in (agg.data or [])]
        avg = sum(ratings) / len(ratings) if ratings else 0

        return {
            "project_id": project_uuid,
            "reviews": res.data or [],
            "count": len(ratings),
            "average_rating": round(avg, 1),
        }
    except Exception:
        return _safe_fallback(project_id)


@router.get("/summary/{project_id}")
def review_summary(project_id: str):
    """Public: just the count + average for a project (lightweight read-time
    aggregate over idx_reviews_project)."""
    try:
        sb = get_client()
        project_uuid = _resolve_uuid(sb, project_id)
        res = (
            sb.table("reviews")
            .select("rating")
            .eq("project_id", project_uuid)
            .execute()
        )

        ratings = [r["rating"] for r in (res.data or [])]
        avg = sum(ratings) / len(ratings) if ratings else 0
        return {
            "project_id": project_uuid,
            "count": len(ratings),
            "average_rating": round(avg, 1),
        }
    except Exception:
        return _safe_fallback(project_id)
