from fastapi import APIRouter, Depends
from pydantic import BaseModel

from auth.privy import require_admin
from db.supabase import get_client

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class RejectBody(BaseModel):
    reason: str


@router.get("/projects/pending")
async def get_pending_projects(_admin=Depends(require_admin)):
    supabase = get_client()
    result = (
        supabase.table("projects")
        .select("*")
        .in_("review_status", ["submitted", "pending"])
        .order("created_at", desc=False)
        .execute()
    )
    return result.data or []


@router.post("/projects/{project_id}/approve")
async def approve_project(project_id: str, _admin=Depends(require_admin)):
    supabase = get_client()
    supabase.table("projects").update(
        {"review_status": "approved", "status": "live"}
    ).eq("id", project_id).execute()
    return {"success": True}


@router.post("/projects/{project_id}/reject")
async def reject_project(project_id: str, body: RejectBody, _admin=Depends(require_admin)):
    supabase = get_client()
    supabase.table("projects").update(
        {
            "review_status": "rejected",
            "rejection_reason": body.reason,
        }
    ).eq("id", project_id).execute()
    return {"success": True}
