from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime, timezone
import re
import secrets

from db.supabase import get_client

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _resolve_owner_uuid(supabase, owner_id: Optional[str]) -> Optional[str]:
    """Resolve any owner identity to a profiles.id UUID (FK target for projects.owner_id).

    - None / empty  → None
    - Valid UUID    → returned as-is (assumed to already be a profiles.id)
    - Privy DID     → users.wallet_address → profiles.id (auto-create profile if needed)
                      If the Privy account has no wallet yet, returns None instead of
                      raising — callers that need a resolved UUID should check the result.
    """
    if not owner_id:
        return None
    if _UUID_RE.match(owner_id):
        return owner_id

    # Step 1: resolve privy_id → wallet_address via users table
    try:
        user_res = (
            supabase.table("users")
            .select("wallet_address")
            .eq("privy_id", owner_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        print(f"[projects] _resolve_owner_uuid users lookup failed: {exc!r}")
        return None

    if not user_res.data or not user_res.data[0].get("wallet_address"):
        # User exists but has no wallet yet — not an error, caller gets None
        return None

    wallet = user_res.data[0]["wallet_address"]

    # Step 2: get or create profile by wallet_address → return profiles.id
    try:
        upsert_res = (
            supabase.table("profiles")
            .upsert({"wallet_address": wallet}, on_conflict="wallet_address")
            .select("id")
            .execute()
        )
        return upsert_res.data[0]["id"] if upsert_res.data else None
    except Exception as exc:
        print(f"[projects] _resolve_owner_uuid profile upsert failed: {exc!r}")
        return None

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
    reason: Optional[str] = None


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

    # Resolve any non-UUID owner identity (e.g. Privy DID) to the users-table UUID.
    # Returns None when wallet not yet linked — project is stored with owner_id=NULL
    # and privy_id set so backfill-owner can claim it when wallet appears.
    owner_uuid = _resolve_owner_uuid(supabase, user_id)
    privy_id_value = user_id if user_id and not _UUID_RE.match(user_id) else None

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
        "owner_id": owner_uuid,
        "privy_id": privy_id_value,
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
        .eq("is_deleted", False)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )

    return res.data or []

# -----------------------------
# List Projects
# -----------------------------

@router.get("/")
async def list_projects(owner_id: Optional[str] = Query(default=None)):
    supabase = get_client()

    query = supabase.table("projects").select("*").eq("is_deleted", False).order("created_at", desc=True)

    if owner_id:
        resolved = _resolve_owner_uuid(supabase, owner_id)
        is_privy_did = owner_id and not _UUID_RE.match(owner_id)
        if resolved:
            # Wallet linked: match by owner_id OR privy_id (catches both old and new rows)
            query = query.or_(f"owner_id.eq.{resolved},privy_id.eq.{owner_id}") if is_privy_did else query.eq("owner_id", resolved)
        elif is_privy_did:
            # No wallet yet: fall back to privy_id column
            query = query.eq("privy_id", owner_id)
        else:
            return []

    res = query.limit(50).execute()

    return res.data or []

# -----------------------------
# Backfill orphaned projects
# -----------------------------

@router.post("/backfill-owner")
async def backfill_owner(owner_id: str = Query(...)):
    """Claim any projects whose wallet_address matches the caller but owner_id is NULL.

    Safe to call repeatedly — only touches rows with owner_id IS NULL.
    Returns the number of rows updated.
    """
    supabase = get_client()

    resolved = _resolve_owner_uuid(supabase, owner_id)

    if not resolved:
        # No wallet linked yet — nothing to backfill by wallet, but privy_id rows
        # are already queryable via list_projects; this is a no-op, not an error.
        return {"updated": 0, "message": "No wallet linked yet — projects tracked by privy_id"}

    # Find the wallet address for this profile so we can match orphaned rows
    profile_res = (
        supabase.table("profiles")
        .select("wallet_address")
        .eq("id", resolved)
        .limit(1)
        .execute()
    )
    if not profile_res.data:
        return {"updated": 0, "message": "Profile not found after resolution"}

    wallet = profile_res.data[0]["wallet_address"]

    # Claim projects where wallet_address matches but owner_id is still NULL.
    # Also claim projects where privy_id matches and owner_id is NULL.
    is_privy_did = owner_id and not _UUID_RE.match(owner_id)
    orphan_filter = supabase.table("projects").select("id").is_("owner_id", "null")
    if is_privy_did:
        orphan_res = orphan_filter.or_(f"wallet_address.eq.{wallet},privy_id.eq.{owner_id}").execute()
    else:
        orphan_res = orphan_filter.eq("wallet_address", wallet).execute()

    if not orphan_res.data:
        return {"updated": 0, "message": "No orphaned projects found"}

    orphan_ids = [row["id"] for row in orphan_res.data]

    update_res = (
        supabase.table("projects")
        .update({"owner_id": resolved})
        .in_("id", orphan_ids)
        .execute()
    )

    count = len(update_res.data) if update_res.data else 0
    print(f"[backfill] set owner_id={resolved} on {count} projects for wallet {wallet[:8]}…")
    return {"updated": count, "message": f"Claimed {count} orphaned project(s)"}


# -----------------------------
# Soft delete project
# -----------------------------

@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    owner_id: str = Query(...),
):
    """Soft-delete a project (sets is_deleted=true). Owner only."""
    supabase = get_client()

    try:
        resolved = _resolve_owner_uuid(supabase, owner_id)
    except HTTPException:
        raise

    if not resolved:
        raise HTTPException(status_code=422, detail="Could not verify owner identity")

    project_res = (
        supabase.table("projects")
        .select("id, owner_id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    if project_res.data[0].get("owner_id") != resolved:
        raise HTTPException(status_code=403, detail="Not project owner")

    supabase.table("projects").update({"is_deleted": True}).eq("id", project_id).execute()

    return {"status": "deleted", "project_id": project_id}


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
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    return project_res.data[0]


# -----------------------------
# Partial update project fields (owner only)
# -----------------------------

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    token_utility: Optional[str] = None


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    x_owner_id: Optional[str] = Header(None),
):
    """Update allowed project fields. Owner only."""
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("id, owner_id")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]

    if x_owner_id:
        resolved = _resolve_owner_uuid(supabase, x_owner_id)
        if resolved != project.get("owner_id"):
            raise HTTPException(status_code=403, detail="Not the project owner")

    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    supabase.table("projects").update(updates).eq("id", project_id).execute()

    updated = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )
    return updated.data
