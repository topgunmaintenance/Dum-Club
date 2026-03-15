from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
import re
from db.supabase import get_client

router = APIRouter()


# -----------------------------
# Request Models
# -----------------------------

class SubmitReviewRequest(BaseModel):
    token_name: str = Field(min_length=3, max_length=32)
    token_symbol: str = Field(min_length=3, max_length=6)
    token_supply: int = Field(gt=0, le=21_000_000)


class RejectProjectRequest(BaseModel):
    reason: str | None = None


# -----------------------------
# Submit Project For Review
# -----------------------------

@router.post("/{project_id}/submit-review")
async def submit_review(
    project_id: str,
    body: SubmitReviewRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False)
):
    supabase = get_client()

    token_name = body.token_name.strip()
    token_symbol = body.token_symbol.strip().upper()
    token_supply = body.token_supply

    if not re.fullmatch(r"[A-Z]{3,6}", token_symbol):
        raise HTTPException(
            status_code=400,
            detail="Token symbol must be 3-6 uppercase letters"
        )

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )

    project = project_res.data

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.get("owner_id") != user_id:
        raise HTTPException(status_code=403, detail="Not project owner")

    # Ensure symbol uniqueness
    symbol_res = (
        supabase.table("projects")
        .select("id")
        .eq("token_symbol", token_symbol)
        .neq("id", project_id)
        .execute()
    )

    if symbol_res.data:
        raise HTTPException(status_code=400, detail="Token symbol already exists")

    update_res = (
        supabase.table("projects")
        .update({
            "token_name": token_name,
            "token_symbol": token_symbol,
            "token_supply": token_supply,
            "review_status": "submitted"
        })
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "project": update_res.data[0] if update_res.data else None
    }


# -----------------------------
# Approve Project
# -----------------------------

@router.post("/{project_id}/approve")
async def approve_project(project_id: str):
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )

    project = project_res.data

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_res = (
        supabase.table("projects")
        .update({"review_status": "approved"})
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "project": update_res.data[0] if update_res.data else None
    }


# -----------------------------
# Reject Project
# -----------------------------

@router.post("/{project_id}/reject")
async def reject_project(project_id: str, body: RejectProjectRequest):
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )

    project = project_res.data

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_res = (
        supabase.table("projects")
        .update({"review_status": "rejected"})
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "reason": body.reason,
        "project": update_res.data[0] if update_res.data else None
    }


# -----------------------------
# Get Project by ID
# -----------------------------

@router.get("/{project_id}")
async def get_project(project_id: str):
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )

    project = project_res.data

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return project


# -----------------------------
# List Projects
# -----------------------------

@router.get("/")
async def list_projects():
    supabase = get_client()

    res = (
        supabase.table("projects")
        .select("*")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )

    return res.data
