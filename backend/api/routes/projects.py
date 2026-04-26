from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime, timezone
import re
import secrets

from db.supabase import get_client
from services.token_mode import is_simulated_token, token_mode


def _attach_token_mode(project: dict) -> dict:
    """
    Additive honesty fields for any endpoint that returns a project row.
    Every response that includes token_mint_address MUST carry is_simulated
    and token_mode. See backend/services/token_mode.py.
    """
    if project is None:
        return project
    mint = project.get("token_mint_address")
    project["is_simulated"] = is_simulated_token(mint)
    project["token_mode"] = token_mode(mint)
    return project

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

    # Resolve ownership: match by owner_id OR privy_id (Privy-authenticated users
    # may only have privy_id set if wallet hasn't been linked yet).
    resolved_owner = _resolve_owner_uuid(supabase, user_id)
    owner_match = (
        (project.get("owner_id") and project["owner_id"] == user_id) or
        (project.get("owner_id") and resolved_owner and project["owner_id"] == resolved_owner) or
        (project.get("privy_id") and project["privy_id"] == user_id)
    )
    if not owner_match:
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
    """Public project listing for /discover.

    Two-pass query: the standard strict listing (approved/live/public)
    plus a second pass for verified founding merchants. The union is
    deduped by id and sorted so that pinned projects (non-null
    sort_order) float to the top.

    Why two passes: founding merchants are seeded via migrations that
    set verified=true + visibility=public but may have status or
    review_status values that don't match the strict listing's
    expectations (e.g. a services storefront with token_status
    'inactive'). Rather than special-case every field, we unconditionally
    include any project with verified=true that isn't hidden/deleted.
    This is the CLAUDE.md v5.0 Phase 0B contract: a verified founding
    merchant must appear on /discover, period.
    """
    supabase = get_client()

    # Pass 1: strict standard listing.
    standard_rows: list[dict] = []
    try:
        res = (
            supabase.table("projects")
            .select("*")
            .eq("review_status", "approved")
            .eq("status", "live")
            .eq("is_deleted", False)
            .eq("visibility", "public")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        standard_rows = res.data or []
    except Exception as exc:
        print(f"[projects] public standard query failed: {exc!r}")

    # Pass 2: verified founding merchants. We accept these even if
    # status/review_status don't line up, because a verified founding
    # merchant is a product-level contract with CLAUDE.md v5.0 Section 6
    # Phase 0B ("/discover shows 1 verified merchant not 0"). Still
    # filter out hidden/deleted rows — verification is not a bypass for
    # soft-delete or visibility.
    verified_rows: list[dict] = []
    try:
        vres = (
            supabase.table("projects")
            .select("*")
            .eq("verified", True)
            .eq("is_deleted", False)
            .eq("visibility", "public")
            .limit(50)
            .execute()
        )
        verified_rows = vres.data or []
    except Exception as exc:
        # Non-fatal: if the `verified` column doesn't exist yet (pre-031
        # migration) this will throw — fall through to standard results.
        print(f"[projects] public verified query failed (ignored): {exc!r}")

    # Union + dedupe by id. Verified rows win when duplicates exist.
    by_id: dict[str, dict] = {}
    for p in standard_rows:
        if p.get("id"):
            by_id[p["id"]] = p
    for p in verified_rows:
        if p.get("id"):
            by_id[p["id"]] = p

    projects = list(by_id.values())

    # Sort: pinned first (sort_order non-null, ascending, 0 = top),
    # then by created_at desc. Pinned verified founding merchants
    # land above the organic firehose.
    def _sort_key(p: dict):
        so = p.get("sort_order")
        pinned = so is None  # False (pinned) sorts before True
        so_val = so if so is not None else 0
        created = p.get("created_at") or ""
        # Invert created_at string for desc order within each pin bucket
        return (pinned, so_val, _neg_iso(created))

    projects.sort(key=_sort_key)
    projects = projects[:50]

    # Attach owner verification status for ranking/badge display
    owner_ids = list(set(p.get("privy_id") for p in projects if p.get("privy_id")))
    verification_map: dict[str, str] = {}
    if owner_ids:
        for oid in owner_ids:
            try:
                biz_res = supabase.table("business_profiles").select("verification_status").eq("owner_privy_id", oid).limit(1).execute()
                if biz_res.data:
                    verification_map[oid] = biz_res.data[0].get("verification_status", "unverified")
            except Exception:
                pass

    for p in projects:
        p["owner_verified"] = (
            verification_map.get(p.get("privy_id", ""), "unverified") == "verified"
            or bool(p.get("verified"))
        )
        _attach_token_mode(p)

    return projects


def _neg_iso(s: str) -> str:
    """Return a string that sorts opposite to the input ISO timestamp.

    Used to turn a default ascending sort into a created_at-desc sort
    within each pin bucket without flipping the whole sort direction.
    """
    if not s:
        return "\uffff"  # empty strings sort last (= oldest)
    # ISO timestamps are lexicographically ordered — flipping each char
    # ordinal gives the opposite sort. This is a cheap trick that avoids
    # parsing the timestamp.
    return "".join(chr(0xFFFF - ord(c)) if ord(c) < 0xFFFF else c for c in s)


@router.get("/live-stats")
async def live_stats():
    """Public endpoint: real counts for ProofOfMotion + landing pages.

    Returns honest counts only. Each field is independently 0 if no
    real data exists; the caller decides whether to render the cell
    or hide it. No fallback copy, no 'launching daily' aspirational
    text — that's a frontend concern.

    `verified_merchants` uses the new merchants.trust_level column
    (migration 030_merchant_trust_level). A merchant is verified when
    trust_level is 'verified' OR 'trusted'. The trust_level is set
    manually by an operator (or by a future periodic recompute job)
    against the rule:
      Stripe Connect active + business_profile with photo + >=1
      published offer with price > 0.
    Today the count is 0 until Topgun (the Phase 0 pilot) is set up
    and an operator flips its trust_level to 'verified' via SQL.

    `visibility='public'` filter excludes founder demo storefronts
    that have been soft-hidden via migration 029.
    """
    supabase = get_client()
    try:
        # Live, public, non-deleted projects.
        projects_res = (
            supabase.table("projects")
            .select("id", count="exact")
            .eq("status", "live")
            .eq("is_deleted", False)
            .eq("visibility", "public")
            .execute()
        )
        offers_res = supabase.table("offers").select("id", count="exact").eq("is_active", True).execute()
        biz_res = supabase.table("business_profiles").select("id", count="exact").execute()

        # Verified merchants: trust_level set to 'verified' or 'trusted'.
        # Uses idx_merchants_trust_level partial index (migration 030).
        verified_res = (
            supabase.table("merchants")
            .select("id", count="exact")
            .in_("trust_level", ["verified", "trusted"])
            .eq("active", True)
            .execute()
        )
    except Exception as exc:
        print(f"[projects] live-stats query failed: {exc!r}")
        return {
            "live_projects": 0,
            "active_offers": 0,
            "businesses": 0,
            "verified_merchants": 0,
        }

    def _count(res) -> int:
        if getattr(res, "count", None) is not None:
            return int(res.count or 0)
        return len(res.data or [])

    return {
        "live_projects": _count(projects_res),
        "active_offers": _count(offers_res),
        "businesses": _count(biz_res),
        "verified_merchants": _count(verified_res),
    }

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

    projects = res.data or []
    for p in projects:
        _attach_token_mode(p)
    return projects

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

    # Resolve by UUID first, fall back to slug. The path param is named
    # project_id for historical reasons but may be either a UUID or a
    # human-readable slug (e.g. 'topgun-maintenance'). We try UUID first
    # because the legacy /project/{uuid} URLs are the vast majority of
    # reads. If the param isn't a valid UUID shape at all we skip the
    # UUID branch and go straight to slug lookup — this avoids a
    # Postgres type error on the .eq("id", ...) query.
    _UUID_SHAPE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)

    project_res = None
    if _UUID_SHAPE.match(project_id):
        project_res = (
            supabase.table("projects")
            .select("*")
            .eq("id", project_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

    if not project_res or not project_res.data:
        project_res = (
            supabase.table("projects")
            .select("*")
            .eq("slug", project_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    resolved = project_res.data[0]
    resolved_id = resolved["id"]

    # Increment view count (fire-and-forget, non-blocking)
    try:
        current_views = resolved.get("view_count", 0) or 0
        supabase.table("projects").update({"view_count": current_views + 1}).eq("id", resolved_id).execute()
    except Exception:
        pass  # Never block page load for analytics

    return _attach_token_mode(resolved)


# -----------------------------
# Partial update project fields (owner only)
# -----------------------------

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    token_utility: Optional[str] = None
    promo_copy: Optional[str] = None
    store_items: Optional[list] = None


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


# -----------------------------
# Live Commerce MVP
# -----------------------------

class GoLiveRequest(BaseModel):
    stream_url: Optional[str] = Field(default=None, max_length=500)
    provider: str = Field(default="manual_embed")  # "native_mux" or "manual_embed"

class PinOfferRequest(BaseModel):
    offer_id: Optional[str] = None


@router.post("/{project_id}/go-live")
async def go_live(
    project_id: str,
    body: GoLiveRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner toggles stream ON with a stream URL."""
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]
    resolved_owner = _resolve_owner_uuid(supabase, user_id)
    owner_match = (
        (project.get("owner_id") and project["owner_id"] == user_id)
        or (project.get("owner_id") and resolved_owner and project["owner_id"] == resolved_owner)
        or (project.get("privy_id") and project["privy_id"] == user_id)
    )
    if not owner_match:
        raise HTTPException(status_code=403, detail="Not project owner")

    owner_privy = project.get("privy_id") or user_id
    merchant_res = (
        supabase.table("merchants")
        .select("stripe_connect_status")
        .eq("owner_privy_id", owner_privy)
        .limit(1)
        .execute()
    )
    merchant_status = (
        merchant_res.data[0].get("stripe_connect_status")
        if merchant_res.data else None
    )
    if merchant_status != "verified":
        print(
            f"[projects] Refusing go_live: project={project_id} "
            f"merchant={owner_privy} stripe_connect_status={merchant_status!r}"
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "merchant_stripe_not_verified",
                "message": (
                    "Stripe onboarding is not complete yet. "
                    "Finish Stripe verification before accepting "
                    "live payments."
                ),
            },
        )

    update_fields: dict = {"is_live": True, "live_provider": body.provider}

    if body.provider == "native_mux":
        from services.mux_live import is_mux_configured, create_live_stream
        if not is_mux_configured():
            raise HTTPException(status_code=503, detail="Mux is not configured on this server — set MUX_TOKEN_ID and MUX_TOKEN_SECRET")
        mux_data = await create_live_stream()
        if "error" in mux_data:
            error_code = mux_data["error"]
            status = 401 if error_code == "mux_auth_failed" else 403 if error_code == "mux_forbidden" else 502
            raise HTTPException(status_code=status, detail=mux_data["detail"])
        update_fields.update({
            "live_stream_id": mux_data["stream_id"],
            "live_playback_id": mux_data["playback_id"],
            "live_stream_key": mux_data["stream_key"],
            "live_ingest_url": mux_data["ingest_url"],
            "stream_url": None,
        })
    else:
        if not body.stream_url or len(body.stream_url.strip()) < 5:
            raise HTTPException(status_code=400, detail="stream_url required for manual embed")
        update_fields.update({
            "stream_url": body.stream_url.strip(),
            "live_stream_id": None,
            "live_playback_id": None,
            "live_stream_key": None,
            "live_ingest_url": None,
        })

    supabase.table("projects").update(update_fields).eq("id", project_id).execute()

    result: dict = {"status": "success", "is_live": True, "provider": body.provider}
    if body.provider == "native_mux":
        result["stream_key"] = update_fields["live_stream_key"]
        result["ingest_url"] = update_fields["live_ingest_url"]
        result["playback_id"] = update_fields["live_playback_id"]
    return result


@router.post("/{project_id}/end-live")
async def end_live(
    project_id: str,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner ends the live stream."""
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]
    resolved_owner = _resolve_owner_uuid(supabase, user_id)
    owner_match = (
        (project.get("owner_id") and project["owner_id"] == user_id)
        or (project.get("owner_id") and resolved_owner and project["owner_id"] == resolved_owner)
        or (project.get("privy_id") and project["privy_id"] == user_id)
    )
    if not owner_match:
        raise HTTPException(status_code=403, detail="Not project owner")

    # Disable Mux stream if native
    live_data = supabase.table("projects").select("live_provider, live_stream_id").eq("id", project_id).limit(1).execute()
    if live_data.data and live_data.data[0].get("live_provider") == "native_mux":
        stream_id = live_data.data[0].get("live_stream_id")
        if stream_id:
            try:
                from services.mux_live import disable_live_stream
                import asyncio
                asyncio.ensure_future(disable_live_stream(stream_id))
            except Exception:
                pass

    supabase.table("projects").update({
        "is_live": False,
        "stream_url": None,
        "pinned_offer_id": None,
        "live_provider": None,
        "live_stream_id": None,
        "live_playback_id": None,
        "live_stream_key": None,
        "live_ingest_url": None,
    }).eq("id", project_id).execute()

    return {"status": "success", "is_live": False}


@router.get("/{project_id}/live-status")
async def get_live_status(project_id: str):
    """Public endpoint: returns live provider info and stream health."""
    supabase = get_client()
    res = (
        supabase.table("projects")
        .select("is_live, live_provider, live_playback_id, live_stream_id, stream_url")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = res.data[0]
    result = {
        "is_live": project.get("is_live", False),
        "provider": project.get("live_provider"),
        "playback_id": project.get("live_playback_id"),
        "stream_url": project.get("stream_url"),
    }

    # Optionally check Mux stream health
    if project.get("live_provider") == "native_mux" and project.get("live_stream_id"):
        try:
            from services.mux_live import get_stream_status
            status = await get_stream_status(project["live_stream_id"])
            result["stream_health"] = status
        except Exception:
            result["stream_health"] = "unknown"

    return result


@router.post("/{project_id}/pin-offer")
async def pin_offer(
    project_id: str,
    body: PinOfferRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner pins (or unpins) an offer during a live stream."""
    supabase = get_client()

    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id, is_live")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]
    resolved_owner = _resolve_owner_uuid(supabase, user_id)
    owner_match = (
        (project.get("owner_id") and project["owner_id"] == user_id)
        or (project.get("owner_id") and resolved_owner and project["owner_id"] == resolved_owner)
        or (project.get("privy_id") and project["privy_id"] == user_id)
    )
    if not owner_match:
        raise HTTPException(status_code=403, detail="Not project owner")

    supabase.table("projects").update({
        "pinned_offer_id": body.offer_id,
    }).eq("id", project_id).execute()

    return {"status": "success", "pinned_offer_id": body.offer_id}
