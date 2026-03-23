from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime, timezone
import re
import secrets

from db.supabase import get_client

router = APIRouter()

# Projects table semantics (avoid mixing these in routes or UI):
# - review_status — internal workflow (pending → submitted → approved | rejected).
# - status          — public publication / discover visibility: stays draft until the
#                     token pipeline reaches trading_live, then advance-token-status sets live.
# - token_status    — on-chain launch lifecycle (draft → … → trading_live), not UI synonyms like "active".

# -----------------------------
# Types / Enums
# -----------------------------

ProjectCategory = Literal["service", "product", "ai", "other"]
UtilityType = Literal["service_hours", "discount", "product_redemption", "access"]

# -----------------------------
# Request Models
# -----------------------------

class ProjectCreateRequest(BaseModel):
    wallet_address: Optional[str] = None
    name: str = Field(min_length=2, max_length=100)
    title: Optional[str] = Field(default=None, max_length=100)
    description: str = Field(min_length=5, max_length=2000)
    category: ProjectCategory
    token_symbol: str = Field(min_length=2, max_length=10)
    token_supply: int = Field(gt=0, le=21_000_000)
    utility_type: UtilityType
    utility_value: str = Field(min_length=1, max_length=255)


class SubmitReviewRequest(BaseModel):
    token_name: str = Field(min_length=2, max_length=100)
    token_symbol: str = Field(min_length=2, max_length=10)
    token_supply: int = Field(gt=0, le=21_000_000)


class RejectProjectRequest(BaseModel):
    reason: str | None = None


class ApproveProjectRequest(BaseModel):
    starting_price: float = Field(default=0.001, gt=0)
    market_cap: float = Field(default=0, ge=0)


class RedemptionRequest(BaseModel):
    wallet: str = Field(min_length=8)
    amount: float = Field(gt=0)

# -----------------------------
# Helpers
# -----------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_claim_code(prefix: str = "DUM") -> str:
    return f"{prefix}-{secrets.token_hex(4).upper()}"


def validate_token_symbol(token_symbol: str) -> str:
    token_symbol = token_symbol.strip().upper()

    if not re.fullmatch(r"[A-Z0-9]{2,10}", token_symbol):
        raise HTTPException(
            status_code=400,
            detail="Token symbol must be 2-10 uppercase letters or numbers"
        )

    return token_symbol

# -----------------------------
# Create Project
# -----------------------------

@router.post("/")
async def create_project(
    body: ProjectCreateRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False)
):
    supabase = get_client()

    token_symbol = validate_token_symbol(body.token_symbol)

    symbol_res = (
        supabase.table("projects")
        .select("id")
        .eq("token_symbol", token_symbol)
        .execute()
    )

    if symbol_res.data:
        raise HTTPException(status_code=400, detail="Token symbol already exists")

    created_at = now_iso()
    title = body.title.strip() if body.title else body.name.strip()

    project_insert = {
        "owner_id": user_id,
        "wallet_address": body.wallet_address,
        "name": body.name.strip(),
        "title": title,
        "description": body.description.strip(),
        "category": body.category,
        "status": "draft",
        "review_status": "pending",
        "template_type": body.category,
        "token_name": title,
        "token_symbol": token_symbol,
        "token_supply": body.token_supply,
        "token_decimals": 0,
        "token_status": "draft",
        "token_utility": body.utility_value.strip(),
        "created_at": created_at,
    }

    project_res = supabase.table("projects").insert(project_insert).execute()

    if not project_res.data:
        raise HTTPException(status_code=500, detail="Failed to create project")

    project = project_res.data[0]
    project_id = project["id"]

    token_config_insert = {
        "project_id": project_id,
        "symbol": token_symbol,
        "supply": body.token_supply,
        "decimals": 0,
        "utility_type": body.utility_type,
        "utility_value": body.utility_value.strip(),
        "created_at": created_at,
    }

    try:
        supabase.table("token_config").insert(token_config_insert).execute()
    except Exception:
        pass

    return {
        "status": "success",
        "message": "Project created and submitted for review",
        "project": project,
    }

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
    token_symbol = validate_token_symbol(body.token_symbol)
    token_supply = body.token_supply

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]

    if project.get("owner_id") != user_id:
        raise HTTPException(status_code=403, detail="Not project owner")

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
            "review_status": "submitted",
            "status": "draft",
            "token_status": "draft",
        })
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "project": update_res.data[0] if update_res.data else None
    }

# -----------------------------
# Approve Project + Go Live
# -----------------------------

@router.post("/{project_id}/approve")
async def approve_project(project_id: str, body: ApproveProjectRequest):
    supabase = get_client()

    try:
        project_res = (
            supabase.table("projects")
            .select("*")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )

        print("APPROVE project_res:", project_res.data)

        if not project_res.data:
            raise HTTPException(status_code=404, detail="Project not found")

        project = project_res.data[0]

        update_res = (
            supabase.table("projects")
            .update({
                "review_status": "approved",
                # Stay off "live" until token reaches trading_live (see advance-token-status).
                "status": "draft",
                "token_status": "draft",
            })
            .eq("id", project_id)
            .execute()
        )

        print("APPROVE update_res:", update_res.data)

        if not update_res.data:
            raise HTTPException(status_code=500, detail="Failed to approve project update")

        market_payload = {
            "project_id": project_id,
            "price": body.starting_price,
            "market_cap": body.market_cap,
            "volume_24h": 0,
            "last_trade_at": None,
            "updated_at": now_iso(),
        }

        existing_market = (
            supabase.table("project_market_state")
            .select("*")
            .eq("project_id", project_id)
            .limit(1)
            .execute()
        )

        print("APPROVE existing_market:", existing_market.data)

        if existing_market.data:
            market_res = (
                supabase.table("project_market_state")
                .update(market_payload)
                .eq("project_id", project_id)
                .execute()
            )
        else:
            market_res = (
                supabase.table("project_market_state")
                .insert(market_payload)
                .execute()
            )

        print("APPROVE market_res:", market_res.data)

        return {
            "status": "success",
            "message": "Project approved; complete the token launch pipeline to go live.",
            "project": update_res.data[0]
        }

    except HTTPException:
        raise
    except Exception as e:
        print("APPROVE ERROR:", repr(e))
        raise HTTPException(status_code=500, detail=f"approve_project failed: {str(e)}")

# -----------------------------
# Review Queue
# -----------------------------

class ReviewDecision(BaseModel):
    decision: str  # "approved" or "rejected"

@router.get("/review-queue")
async def get_review_queue():
    supabase = get_client()

    res = (
        supabase.table("projects")
        .select("*")
        .eq("review_status", "submitted")
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []


# -----------------------------
# Reject Project
# -----------------------------

@router.post("/{project_id}/reject")
async def reject_project(project_id: str, body: RejectProjectRequest):
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    update_res = (
        supabase.table("projects")
        .update({
            "review_status": "rejected",
            "status": "rejected",
            "token_status": "rejected",
        })
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "reason": body.reason,
        "project": update_res.data[0] if update_res.data else None
    }

# -----------------------------
# Get Token Config
# -----------------------------

@router.get("/{project_id}/token-config")
async def get_token_config(project_id: str):
    supabase = get_client()

    res = (
        supabase.table("token_config")
        .select("*")
        .eq("project_id", project_id)
        .limit(1)
        .execute()
    )

    if not res.data:
        return {
            "project_id": project_id,
            "symbol": None,
            "supply": None,
            "utility_type": None,
            "utility_value": None,
        }

    return res.data[0]

# -----------------------------
# Redeem Token
# -----------------------------

@router.post("/{project_id}/redeem")
async def redeem_project_token(project_id: str, body: RedemptionRequest):
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]

    if project.get("status") != "live":
        raise HTTPException(status_code=400, detail="Project is not live for redemption")

    claim_code = generate_claim_code(project.get("token_symbol", "DUM"))

    redemption_insert = {
        "project_id": project_id,
        "wallet": body.wallet,
        "amount": body.amount,
        "code": claim_code,
        "status": "pending",
        "created_at": now_iso(),
    }

    redemption_res = supabase.table("redemptions").insert(redemption_insert).execute()

    if not redemption_res.data:
        raise HTTPException(status_code=500, detail="Failed to create redemption")

    return {
        "status": "success",
        "message": "Redemption created",
        "code": claim_code,
        "redemption": redemption_res.data[0],
    }

# -----------------------------
# List Redemptions
# -----------------------------

@router.get("/{project_id}/redemptions")
async def list_redemptions(project_id: str):
    supabase = get_client()

    res = (
        supabase.table("redemptions")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []

# -----------------------------
# List Public Projects
# -----------------------------

@router.get("/public")
async def list_public_projects():
    supabase = get_client()

    res = (
        supabase.table("projects")
        .select("*")
        .eq("review_status", "approved")
        .eq("status", "live")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )

    return res.data or []

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

    return res.data or []

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
        .limit(1)
        .execute()
    )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    return project_res.data[0]
