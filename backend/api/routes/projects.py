from fastapi import APIRouter, HTTPException, Header, Query, Response
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime, timedelta, timezone
import asyncio
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


def resolve_project_uuid(supabase, project_id_or_slug: Optional[str]) -> Optional[str]:
    """Accept a project UUID OR slug, return the canonical projects.id UUID.

    Returns None if no matching project (or it's soft-deleted).

    Why this exists:
      Frontend pages like /project/[id] are addressable by both UUID and
      slug, and the URL param is forwarded verbatim to backend endpoints
      (e.g. POST /api/ivs/viewer-token, GET /api/projects/{id}/market).
      Several endpoints historically did `.eq(\"id\", project_id)` — which
      silently returns no rows when the param is a slug, producing 404s and
      500s on user-facing pages.

      The canonical /api/projects/{id} GET handler already implements
      try-UUID-then-slug; this helper extracts that fallback so every
      endpoint that takes a {project_id} path/body param can resolve to
      the same UUID without re-implementing the dance.

    Mirrors the .eq(\"is_deleted\", False) filter used by /api/projects/{id}
    so soft-deleted projects are uniformly invisible.
    """
    if not project_id_or_slug:
        return None

    # 1) Try UUID match. Wrapped in try/except because PostgREST may error
    #    on a UUID column when given a non-UUID-shaped string.
    try:
        res = (
            supabase.table("projects")
            .select("id")
            .eq("id", project_id_or_slug)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]["id"]
    except Exception:
        pass

    # 2) Fall back to slug.
    try:
        res = (
            supabase.table("projects")
            .select("id")
            .eq("slug", project_id_or_slug)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]["id"]
    except Exception:
        pass

    return None


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

    # Step 2: get or create profile by wallet_address → return profiles.id.
    # postgrest-py 0.16 (shipped with supabase-py 2.5.1) returns a
    # SyncQueryRequestBuilder from .upsert(), and that builder no
    # longer exposes .select() — the previous chain raised
    # AttributeError on every onboarding upsert. PostgREST sets
    # Prefer: return=representation by default, so upsert_res.data
    # already contains the affected rows with all columns including id.
    try:
        upsert_res = (
            supabase.table("profiles")
            .upsert({"wallet_address": wallet}, on_conflict="wallet_address")
            .execute()
        )
        return upsert_res.data[0]["id"] if upsert_res.data else None
    except Exception as exc:
        print(f"[projects] _resolve_owner_uuid profile upsert failed: {exc!r}")
        return None


def _resolve_account_id(supabase, owner_id: Optional[str]) -> Optional[str]:
    """Resolve a Privy DID to the canonical accounts.id UUID.

    Lookup path:
        Privy DID  ->  account_logins.privy_did  ->  accounts.id

    Returns None when:
      - owner_id is empty
      - owner_id is already a UUID (treated as an accounts.id; returned as-is)
      - the DID has no account_logins row yet (caller falls back to legacy
        _resolve_owner_uuid path so pre-canonical projects keep working)

    Introduced by the canonical-accounts migration (055-058). Lives
    alongside _resolve_owner_uuid; does not replace it. Only list_projects
    consumes it today — other call sites stay on the legacy resolver
    until a future targeted migration moves them over.
    """
    if not owner_id:
        return None
    if _UUID_RE.match(owner_id):
        return owner_id
    try:
        res = (
            supabase.table("account_logins")
            .select("account_id")
            .eq("privy_did", owner_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        print(f"[projects] _resolve_account_id lookup failed: {exc!r}")
        return None
    if not res.data:
        return None
    return res.data[0]["account_id"]


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

    # Accept slug or UUID — frontend forwards URL param verbatim.
    resolved_uuid = resolve_project_uuid(supabase, project_id) or project_id

    res = (
        supabase.table("redemptions")
        .select("*")
        .eq("project_id", resolved_uuid)
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
            .select("*, business_profile:business_profiles!projects_business_profile_id_fkey(logo_url, cover_image_url)")
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
            .select("*, business_profile:business_profiles!projects_business_profile_id_fkey(logo_url, cover_image_url)")
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

    # Pass 3: actively-live projects. A store that is broadcasting right now
    # should be discoverable while live, regardless of review_status /
    # publication status — live commerce surfaces live sellers, and a real
    # merchant who clicks Go Live must show up on /discover. Still respect
    # visibility + soft-delete. Going live requires Stripe verification
    # upstream (ivs /create-stage), so this is not an open door.
    live_rows: list[dict] = []
    try:
        lres = (
            supabase.table("projects")
            .select("*, business_profile:business_profiles!projects_business_profile_id_fkey(logo_url, cover_image_url)")
            .eq("is_live", True)
            .eq("is_deleted", False)
            .eq("visibility", "public")
            .limit(50)
            .execute()
        )
        live_rows = lres.data or []
    except Exception as exc:
        print(f"[projects] public live query failed (ignored): {exc!r}")

    # Union + dedupe by id. Verified / live rows win when duplicates exist.
    by_id: dict[str, dict] = {}
    for p in standard_rows:
        if p.get("id"):
            by_id[p["id"]] = p
    for p in verified_rows:
        if p.get("id"):
            by_id[p["id"]] = p
    for p in live_rows:
        if p.get("id"):
            by_id[p["id"]] = p

    projects = list(by_id.values())

    # Mirror the frontend isDiscoverable description gate (filters.ts:97-98)
    # plus the live bypass (filters.ts:95). Live broadcasts surface
    # regardless of description length; everything else needs >=20 chars so
    # /discover doesn't show shells. After PR #364 auto-approves founding
    # storefronts at signup, this gate is what guarantees a founding row
    # with an empty description still doesn't appear until the merchant
    # writes one. Single source of truth at the backend per owner D3.
    projects = [
        p for p in projects
        if p.get("is_live") is True
        or len((p.get("description") or "").strip()) >= 20
    ]

    # Enrich each project with active_offer_count from the modern offers
    # table (PR #354 server-mediated path). The frontend isDiscoverable
    # gate at filters.ts:96 historically only checked store_items JSONB,
    # which rejected modern-flow storefronts whose offers live in the
    # offers table instead. Decorating the response payload here lets the
    # frontend honor both sources without an extra round trip. Single
    # bulk SELECT bounded by the post-3-pass project list (max ~50 rows),
    # aggregated in Python so no Postgres function is needed.
    project_ids = [p["id"] for p in projects if p.get("id")]
    active_offer_counts: dict[str, int] = {}
    if project_ids:
        try:
            offer_rows = (
                supabase.table("offers")
                .select("project_id")
                .eq("is_active", True)
                .in_("project_id", project_ids)
                .execute()
            )
            for row in (offer_rows.data or []):
                pid = row.get("project_id")
                if pid:
                    active_offer_counts[pid] = active_offer_counts.get(pid, 0) + 1
        except Exception as exc:
            # Non-fatal: failure to enrich falls back to active_offer_count=0
            # for all rows. Frontend gate then uses store_items only (today's
            # behavior). Logged so the operator sees the regression.
            print(f"[projects] active_offer_count enrichment failed: {exc!r}")
    for p in projects:
        p["active_offer_count"] = active_offer_counts.get(p.get("id", ""), 0)

    # Stripe-verified gate (owner policy: only real businesses that can
    # take payment are publicly discoverable). Mirrors the publish-gate
    # Stripe check in _set_publication_status and the go-live gate in
    # ivs.py create-stage — both already require stripe_connect_status
    # == 'verified'. This read-time filter closes the gap where a row
    # was made public via founding auto-approve + a direct visibility
    # backfill, bypassing both write-time gates. Applied post-union so
    # all three passes (standard, verified-founder, live) are covered.
    # One bulk SELECT against merchants keyed on owner_privy_id; keep
    # only projects whose owner is Stripe-verified. Bounded by the
    # ~50-row post-3-pass list. Fail-CLOSED: if the lookup errors we
    # can't confirm Stripe status, so we surface nothing rather than
    # risk listing a storefront that can't take payment.
    owner_privy_ids = list({p.get("privy_id") for p in projects if p.get("privy_id")})
    verified_owners: set[str] = set()
    if owner_privy_ids:
        try:
            merch_rows = (
                supabase.table("merchants")
                .select("owner_privy_id, stripe_connect_status")
                .in_("owner_privy_id", owner_privy_ids)
                .eq("stripe_connect_status", "verified")
                .execute()
            )
            verified_owners = {
                r["owner_privy_id"] for r in (merch_rows.data or [])
                if r.get("owner_privy_id")
            }
        except Exception as exc:
            print(f"[projects] stripe-verified discovery gate lookup failed: {exc!r}")
            verified_owners = set()
    projects = [p for p in projects if p.get("privy_id") in verified_owners]

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

    # Attach in-memory viewer count for currently-live projects so the
    # Discover cards can render "12 watching" without N parallel
    # /embed-config fetches. get_viewer_count is a defaultdict lookup
    # populated by the chat WebSocket — zero-cost for offline projects.
    # Same listing also runs the heartbeat-staleness check so a host
    # who disconnects without firing /end-stage doesn't keep a "Live
    # now" card on /discover indefinitely.
    try:
        from services.live_limits import (
            get_viewer_count,
            is_heartbeat_stale,
            mark_stale_cleared,
            was_stale_cleared,
            clear_stream,
        )
    except Exception:
        get_viewer_count = None  # type: ignore[assignment]
        is_heartbeat_stale = None  # type: ignore[assignment]
        mark_stale_cleared = None  # type: ignore[assignment]
        was_stale_cleared = None  # type: ignore[assignment]
        clear_stream = None  # type: ignore[assignment]

    for p in projects:
        p["owner_verified"] = (
            verification_map.get(p.get("privy_id", ""), "unverified") == "verified"
            or bool(p.get("verified"))
        )
        # On-read auto-clear. Mirrors /embed-config + /live-status.
        if (
            is_heartbeat_stale
            and p.get("is_live")
            and p.get("id")
            and is_heartbeat_stale(p["id"])
            and not (was_stale_cleared and was_stale_cleared(p["id"]))
        ):
            # IVS Real-Time path: delete the AWS stage so it doesn't
            # persist as a billable orphan (the DB UPDATE alone leaves the
            # AWS stage alive). Best-effort + lazy import; no-op if the
            # project wasn't on IVS.
            _delete_orphan_ivs_stage(supabase, p["id"])
            # Phase 0 telemetry — close the stream_sessions row on the
            # stale-clear path so we capture host-disconnect lifetimes,
            # not just clean /end-stage calls. Best-effort.
            from services.stream_telemetry import on_stream_end
            on_stream_end(supabase, p["id"], "stale_heartbeat")
            try:
                supabase.table("projects").update({
                    "is_live": False,
                    "ivs_stage_arn": None,
                    "ivs_stage_id": None,
                }).eq("id", p["id"]).eq("is_live", True).execute()
            except Exception:
                pass
            if clear_stream:
                clear_stream(p["id"])
            if mark_stale_cleared:
                mark_stale_cleared(p["id"])
            p["is_live"] = False
            p["ivs_stage_arn"] = None
            p["ivs_stage_id"] = None
        if get_viewer_count and p.get("is_live") and p.get("id"):
            try:
                p["viewer_count"] = int(get_viewer_count(p["id"]))
            except Exception:
                p["viewer_count"] = 0
        else:
            p["viewer_count"] = 0
        _attach_token_mode(p)

    return projects


# ── In-memory TTL cache for the discover feed ──
# The feed is identical for all anonymous visitors within a short window,
# so caching the fully-computed body (projects + market loop) for 30s
# collapses a burst of identical requests into one round of DB work. No
# explicit invalidation: a 30s TTL bounds staleness and matches the
# endpoint's Cache-Control max-age, so a merchant going live shows up
# within ~30s (the frontend also polls). Process-local — fine for the
# read-mostly discover feed; not a correctness-critical cache.
import time as _time

_DISCOVER_CACHE: dict[str, tuple[float, dict]] = {}
_DISCOVER_TTL = 30.0
_DISCOVER_MAX = 256


def _discover_cache_get(key: str) -> Optional[dict]:
    item = _DISCOVER_CACHE.get(key)
    if not item:
        return None
    ts, val = item
    if _time.time() - ts > _DISCOVER_TTL:
        _DISCOVER_CACHE.pop(key, None)
        return None
    return val


def _discover_cache_set(key: str, val: dict) -> None:
    if len(_DISCOVER_CACHE) >= _DISCOVER_MAX and key not in _DISCOVER_CACHE:
        # Evict the oldest entry to bound memory.
        oldest = min(_DISCOVER_CACHE.items(), key=lambda kv: kv[1][0])[0]
        _DISCOVER_CACHE.pop(oldest, None)
    _DISCOVER_CACHE[key] = (_time.time(), val)


@router.get("/discover")
async def discover_projects(
    response: Response,
    limit: int = Query(24, ge=1),
    offset: int = Query(0, ge=0),
    category: Optional[str] = None,
    live_only: bool = False,
    search: Optional[str] = None,
    if_none_match: Optional[str] = Header(None),
):
    """Consolidated /discover feed: projects + their market summary in ONE
    request, replacing the old fan-out (GET /public + N x /{id}/market).

    Scaling approach (per the "server-side loop" decision): this reuses the
    existing list_public_projects() logic verbatim and loops the existing
    compute_market_snapshot() per project on the SERVER. The browser makes
    exactly one HTTP request instead of 1 + N. Market math is byte-identical
    to GET /api/projects/{id}/market. Reducing the per-call Supabase query
    count (indexes / true aggregation) is deferred to the DB + caching PRs.

    Filters (category / live_only / search) and pagination run in Python on
    the already-capped public list — consistent with the existing endpoint,
    which builds its union and sort in Python. limit is capped at 100.
    """
    if limit > 100:
        raise HTTPException(status_code=400, detail="limit must be <= 100")

    cache_key = f"{limit}:{offset}:{(category or '').lower()}:{int(live_only)}:{(search or '').lower()}"
    body = _discover_cache_get(cache_key)

    if body is None:
        all_projects = await list_public_projects()

        filtered = all_projects
        if category:
            c = category.strip().lower()
            filtered = [p for p in filtered if (p.get("category") or "").strip().lower() == c]
        if live_only:
            filtered = [p for p in filtered if p.get("is_live")]
        if search:
            q = search.strip().lower()
            filtered = [
                p
                for p in filtered
                if q in (p.get("name") or p.get("title") or "").lower()
                or q in (p.get("description") or "").lower()
            ]

        total = len(filtered)
        page = filtered[offset : offset + limit]

        # Server-side market loop — one request from the browser, exact same
        # math. Lazy import: market.py lazily imports this module, so a
        # top-level import here would risk a circular import at startup.
        from api.routes.market import compute_market_snapshot

        supabase = get_client()
        for p in page:
            pid = p.get("id")
            if not pid:
                p["market_summary"] = None
                continue
            try:
                snap = compute_market_snapshot(supabase, pid)
                p["market_summary"] = {
                    "price": snap["price"],
                    "market_cap": snap["market_cap"],
                    "volume_24h": snap["volume_24h"],
                }
            except Exception as exc:
                print(f"[projects] discover market compute failed for {pid}: {exc!r}")
                p["market_summary"] = None

        body = {
            "projects": page,
            "limit": limit,
            "offset": offset,
            "total": total,
            "has_more": offset + limit < total,
        }
        _discover_cache_set(cache_key, body)

    # ETag from the page's content stamps so an unchanged feed returns 304.
    import hashlib

    stamps = [
        str(p.get("updated_at") or p.get("created_at") or "")
        for p in body["projects"]
    ]
    etag = '"' + hashlib.sha1(
        (f"{offset}:{limit}:{body['total']}:" + "|".join(stamps)).encode("utf-8")
    ).hexdigest() + '"'

    cache_headers = {
        "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
        "ETag": etag,
    }
    response.headers.update(cache_headers)
    if if_none_match and if_none_match == etag:
        return Response(status_code=304, headers=cache_headers)

    return body


# ── Live cards (homepage "Go Live" rail) ─────────────────────────────

LIVE_HEARTBEAT_WINDOW_SECONDS = 90

# Cleared when a stale live row is reaped. Matches the on-read auto-clear
# used by the discover feed (is_live + IVS stage handles).
_REAP_CLEAR_FIELDS = {
    "is_live": False,
    "ivs_stage_arn": None,
    "ivs_stage_id": None,
}


def reap_stale_live(supabase) -> int:
    """Flip is_live=false on projects whose most recent heartbeat is older
    than the 90s liveness window. NULL-heartbeat rows are left alone (a
    just-went-live storefront before its first heartbeat); the startup
    sweep in main.py handles long-lived NULL orphans via updated_at.
    Best-effort; returns the number of rows reaped. Safe to call from a
    cron as well as on-read."""
    from datetime import timedelta
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=LIVE_HEARTBEAT_WINDOW_SECONDS)
    ).isoformat()
    try:
        res = (
            supabase.table("projects")
            .update(_REAP_CLEAR_FIELDS)
            .eq("is_live", True)
            .not_.is_("last_heartbeat_at", "null")
            .lt("last_heartbeat_at", cutoff)
            .execute()
        )
        n = len(res.data or [])
        if n:
            print(f"[live-cards] reaped {n} stale live project(s)")
        return n
    except Exception as exc:
        print(f"[live-cards] reaper failed: {exc!r}")
        return 0


def _featured_offer(project: dict) -> Optional[dict]:
    """Featured offer for a card: the pinned offer if set and still active,
    else the most recently created active offer. Expects an embedded
    `offers` list on the row."""
    offers = project.get("offers") or []
    if not isinstance(offers, list) or not offers:
        return None
    pinned_id = project.get("pinned_offer_id")
    if pinned_id:
        for o in offers:
            if o.get("id") == pinned_id and o.get("is_active"):
                return o
    active = [o for o in offers if o.get("is_active")]
    if not active:
        return None
    active.sort(key=lambda o: o.get("created_at") or "", reverse=True)
    return active[0]


def _within_live_window(ts_iso: Optional[str], cutoff_iso: str) -> bool:
    """True when ts_iso is newer than cutoff_iso. ISO-8601 UTC strings sort
    lexicographically; both sides here originate from Postgres timestamptz
    / our own UTC isoformat()."""
    if not ts_iso:
        return False
    try:
        return ts_iso > cutoff_iso
    except Exception:
        return False


@router.get("/live-cards")
async def live_cards(limit: int = Query(12, ge=1, le=50)):
    """Homepage 'Go Live' rail. Currently-live storefronts with the merchant
    (logo / business_name / category) and featured offer joined. Liveness =
    is_live AND last_heartbeat_at within 90s. Runs the reaper first so stale
    rows are flipped off before the read. live_viewer_count drives the count
    (column pending migration 077; falls back to 0 if absent)."""
    supabase = get_client()
    reap_stale_live(supabase)

    from datetime import timedelta
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=LIVE_HEARTBEAT_WINDOW_SECONDS)
    ).isoformat()

    _full_select = (
        "id, slug, name, title, is_live, last_heartbeat_at, updated_at, "
        "pinned_offer_id, live_viewer_count, "
        "business_profile:business_profiles!projects_business_profile_id_fkey(logo_url, business_name, category), "
        "offers(id, title, price_usd, is_active, created_at)"
    )
    _lite_select = _full_select.replace("live_viewer_count, ", "")

    def _query(select_str: str):
        return (
            supabase.table("projects")
            .select(select_str)
            .eq("is_live", True)
            .eq("is_deleted", False)
            .eq("visibility", "public")
            .limit(limit)
            .execute()
        ).data or []

    try:
        rows = _query(_full_select)
    except Exception as exc:
        # live_viewer_count is pending migration 077; if the column is not
        # there yet the select errors. Retry without it so the rail still
        # works pre-migration (count defaults to 0).
        print(f"[live-cards] full select failed (live_viewer_count pending migration?): {exc!r}")
        try:
            rows = _query(_lite_select)
        except Exception as exc2:
            print(f"[live-cards] lite select failed: {exc2!r}")
            rows = []

    cards = []
    for p in rows:
        hb = p.get("last_heartbeat_at")
        # Heartbeat within window, OR a fresh go-live whose first heartbeat
        # hasn't landed yet (NULL heartbeat + recent updated_at).
        live = _within_live_window(hb, cutoff) or (
            hb is None and _within_live_window(p.get("updated_at"), cutoff)
        )
        if not live:
            continue
        bp = p.get("business_profile") or {}
        offer = _featured_offer(p)
        cards.append({
            "id": p.get("id"),
            "slug": p.get("slug"),
            "name": bp.get("business_name") or p.get("name") or p.get("title") or "Untitled",
            "logo_url": bp.get("logo_url"),
            "category": bp.get("category"),
            "is_live": True,
            "viewer_count": int(p.get("live_viewer_count") or 0),
            "featured_offer": (
                {
                    "id": offer.get("id"),
                    "title": offer.get("title"),
                    "price_usd": offer.get("price_usd"),
                } if offer else None
            ),
        })

    # All cards are live; within that, busiest first.
    cards.sort(key=lambda c: c.get("viewer_count") or 0, reverse=True)
    return cards[:limit]


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
        # live_projects: align with the /api/projects/public union — same
        # set the /discover feed renders. Previously this only counted
        # status='live' + public + not-deleted, which inflated against
        # the union doctrine (verified founding merchants + actively
        # broadcasting carve-outs). On prod today: 3 narrow vs 1 union
        # (Topgun) — the homepage's ProofOfMotion "Businesses live"
        # display caught this drift.
        #
        # Union shape (mirrors list_public_projects Pass 1/2/3):
        #   (review_status='approved' AND status='live')
        #   OR verified=true
        #   OR is_live=true
        # all gated by visibility='public' AND is_deleted=false.
        UNION_OR = (
            "and(review_status.eq.approved,status.eq.live),"
            "verified.eq.true,"
            "is_live.eq.true"
        )
        projects_res = (
            supabase.table("projects")
            .select("id", count="exact")
            .eq("is_deleted", False)
            .eq("visibility", "public")
            .or_(UNION_OR)
            .execute()
        )
        # active_offers: align to the SAME union via reference_table on
        # the inner-joined projects row. Today this still resolves to 6
        # (Topgun's services — verified AND status='live' AND approved),
        # but future-proofs against a Pass-2-only verified merchant whose
        # offers would otherwise be missed from this count while their
        # project shows on the /discover feed via Pass 2. Symmetry with
        # live_projects + the union doctrine — closes the latent
        # consistency drift before it can ever surface.
        offers_res = (
            supabase.table("offers")
            .select("id, projects!inner(id)", count="exact")
            .eq("is_active", True)
            .eq("projects.is_deleted", False)
            .eq("projects.visibility", "public")
            .or_(UNION_OR, reference_table="projects")
            .execute()
        )
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


def _delete_orphan_ivs_stage(supabase, project_id: str) -> None:
    """When the heartbeat-staleness check flips is_live=False on a project
    that was streaming via IVS Real-Time, also delete the AWS stage.
    Otherwise the stage persists on AWS, billing per participant-minute
    against a phantom session if any subscribers were still attached when
    the host's tab crashed.

    Best-effort: never blocks the DB stale-clear path. Looks up the stage
    ARN just-in-time so the existing SELECTs at each stale-clear site
    don't need to be modified to carry ivs_stage_arn.

    Called from the three on-read auto-clear sites:
      - list_public_projects (rendering /discover and related)
      - GET /api/projects/{id}/embed-config (the bubble's source of truth)
      - GET /api/projects/{id}/live-status  (the host page's live ping)
    """
    try:
        res = (
            supabase.table("projects")
            .select("live_provider, ivs_stage_arn")
            .eq("id", project_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return
        row = res.data[0]
        if row.get("live_provider") != "ivs_realtime":
            return
        arn = row.get("ivs_stage_arn")
        if not arn:
            return
        from services.ivs_realtime import delete_stage
        delete_stage(arn)
    except Exception as exc:  # noqa: BLE001
        print(f"[ivs] stale-clear orphan delete failed for {project_id}: {exc!r}")


# -----------------------------
# List Projects
# -----------------------------

@router.get("/")
async def list_projects(owner_id: Optional[str] = Query(default=None)):
    """List projects owned by the caller.

    Resolution order (since canonical-accounts migration 055-058):
      1. owner_id -> account_logins.account_id -> projects.account_id (NEW)
      2. Legacy: owner_id -> profiles.id via wallet bridge
      3. Last-resort: projects.privy_id direct match

    Step 1 returns every storefront under the canonical account regardless
    of which Privy DID the caller logged in with. Steps 2-3 cover rows
    that have not yet been backfilled with an account_id (the ~58 demo /
    Phase-0A artifacts left untouched by the 055-058 migration).
    """
    supabase = get_client()

    query = supabase.table("projects").select("*").eq("is_deleted", False).order("created_at", desc=True)

    if owner_id:
        account_id = _resolve_account_id(supabase, owner_id)
        if account_id:
            query = query.eq("account_id", account_id)
        else:
            # Legacy fallback (pre-canonical-accounts behavior, preserved).
            resolved = _resolve_owner_uuid(supabase, owner_id)
            is_privy_did = owner_id and not _UUID_RE.match(owner_id)
            if resolved:
                query = query.or_(f"owner_id.eq.{resolved},privy_id.eq.{owner_id}") if is_privy_did else query.eq("owner_id", resolved)
            elif is_privy_did:
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
            .select(
                "*, business_profile:business_profiles!projects_business_profile_id_fkey("
                "logo_url, cover_image_url, verification_status, business_name)"
            )
            .eq("id", project_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

    if not project_res or not project_res.data:
        project_res = (
            supabase.table("projects")
            .select(
                "*, business_profile:business_profiles!projects_business_profile_id_fkey("
                "logo_url, cover_image_url, verification_status, business_name)"
            )
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
# Public embed-config (CORS-open)
# -----------------------------

@router.get("/{project_id}/embed-config")
async def get_embed_config(project_id: str, response: Response):
    """
    Minimal public read for embed.js. Returns the merchant-chosen
    outer display mode (bubble / full / automatic) plus the inner
    pop-in greeting payload (popin_config) so the embed script can
    drive the floating bubble on the merchant's own site without a
    second round-trip.

    CORS is explicitly opened to "*" because embed.js runs on the
    merchant's own website (e.g. topgunmaintenance.com) which is
    NOT on the regular CORSMiddleware allow-list — by design.
    Every field returned here is public information already
    visible on /embed/{id}; nothing sensitive crosses this
    boundary. GET only.

    Resilience contract:
      This endpoint MUST NOT 5xx. embed.js is loaded on third-party
      merchant sites; an upstream 5xx collapses the embed back to a
      hard-to-debug "renders the wrong UI" failure mode (see PR fix
      for the topgunmaintenance.com bubble outage). Any unexpected
      Supabase/DB error degrades to a 200 with conservative defaults
      so the merchant page keeps rendering something sane while the
      backend log captures the real exception.
    """
    # Common CORS headers — set unconditionally so every code path
    # (success, 404, soft-degraded fallback) is readable cross-origin.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    # 15s public cache. Cut from 60s to keep go-live transitions
    # snappy: when a merchant flips is_live, visitors who land in
    # the next minute were previously stuck on the pre-live
    # response. 15s is a reasonable floor that still cuts most of
    # the request volume from third-party merchant sites.
    response.headers["Cache-Control"] = "public, max-age=15"

    def _fallback(reason: str) -> dict:
        # Log the slug + reason so Railway picks up the real cause
        # without leaking an exception to the merchant's page.
        try:
            import logging
            logging.getLogger(__name__).warning(
                "embed-config soft-degraded for project_id=%r reason=%s",
                project_id,
                reason,
            )
        except Exception:
            pass
        return {
            "schema_version": "v1.7",
            "id": None,
            "slug": project_id,
            "embed_display_mode": "automatic",
            "is_live": False,
            "live_provider": None,
            "ivs_stage_arn": None,
            "pinned_offer_id": None,
            "pinned_offer": None,
            "active_offers": [],
            "live_session": None,
            "popin_config": {},
            "degraded": True,
        }

    try:
        supabase = get_client()
    except Exception as exc:
        return _fallback(f"supabase_client_init:{type(exc).__name__}")

    # Accept slug or UUID — frontend forwards the merchant's
    # business id verbatim. resolve_project_uuid handles both.
    try:
        resolved_uuid = resolve_project_uuid(supabase, project_id)
    except Exception as exc:
        return _fallback(f"resolve_uuid:{type(exc).__name__}")

    if not resolved_uuid:
        # Genuine not-found stays a 404 (with CORS already set
        # above so the browser can read the body inline). This is
        # the only non-200 path we deliberately keep — a missing
        # business id is a snippet / dashboard mistake, not a
        # transient backend failure.
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        res = (
            supabase.table("projects")
            .select(
                "id, slug, embed_display_mode, is_live, live_provider, "
                "ivs_stage_arn, pinned_offer_id, pinned_until, popin_config"
            )
            .eq("id", resolved_uuid)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        # Most likely path here is a transient Supabase / PostgREST
        # error or a column drift if migration 040 / 038 ever
        # regresses. Soft-degrade rather than 5xx.
        return _fallback(f"projects_select:{type(exc).__name__}")

    if not res.data:
        # Project resolved but row disappeared between calls (race).
        # Treat as 404 to match the genuine-not-found path above.
        raise HTTPException(status_code=404, detail="Project not found")

    row = res.data[0]
    popin_raw = row.get("popin_config") or {}
    if not isinstance(popin_raw, dict):
        popin_raw = {}

    # Hydrate pinned_offer details (title + price) so embed.js can
    # render a single product chip next to the host-site bubble
    # without a second cross-origin round trip. Same CORS-open
    # response, same 60s cache, additive only — failure to load the
    # offer is silently degraded to None so the chip just doesn't
    # render. Price is normalised to a number; titles are passed
    # through verbatim (textContent on the host side handles escaping).
    pinned_offer_payload = None
    pinned_offer_id = row.get("pinned_offer_id")
    if pinned_offer_id:
        try:
            offer_res = (
                supabase.table("offers")
                .select("id, title, price_usd")
                .eq("id", pinned_offer_id)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            if offer_res.data:
                offer_row = offer_res.data[0]
                price_raw = offer_row.get("price_usd")
                try:
                    price_val = float(price_raw) if price_raw is not None else None
                except (TypeError, ValueError):
                    price_val = None
                pinned_offer_payload = {
                    "id": offer_row.get("id"),
                    "title": offer_row.get("title") or "",
                    "price_usd": price_val,
                }
        except Exception:
            # Swallow — embed-config must not 5xx on third-party
            # merchant sites; the chip just won't render.
            pinned_offer_payload = None

    # Hydrate up to 3 active offers for the host-page bubble's
    # product stack. Pinned offer comes first when present; the
    # rest are most-recently-created active offers. We bound the
    # query at 4 so we can drop the pinned id from a 1+3 result
    # without an additional round trip. Same CORS-open response,
    # same 60s cache, soft-fails to an empty list on any error so
    # the bubble gracefully falls back to "no stack".
    active_offers_payload: list[dict] = []
    try:
        offers_query = (
            supabase.table("offers")
            .select(
                "id, title, price_usd, quantity_available, "
                "quantity_sold, unlimited_inventory"
            )
            .eq("project_id", resolved_uuid)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(4)
            .execute()
        )
        raw_offers = list(offers_query.data or [])
        # Pinned first, then most-recently-created. The dedupe by
        # id keeps a pinned offer from appearing twice if it also
        # happens to be in the latest-4 window.
        ordered: list[dict] = []
        if pinned_offer_id:
            for o in raw_offers:
                if o.get("id") == pinned_offer_id:
                    ordered.append(o)
                    break
        for o in raw_offers:
            if o.get("id") == pinned_offer_id:
                continue
            ordered.append(o)
            if len(ordered) >= 3:
                break
        ordered = ordered[:3]
        for o in ordered:
            price_raw = o.get("price_usd")
            try:
                price_val = float(price_raw) if price_raw is not None else None
            except (TypeError, ValueError):
                price_val = None
            quantity_remaining = None
            if not o.get("unlimited_inventory"):
                qa = o.get("quantity_available")
                qs = o.get("quantity_sold") or 0
                if qa is not None:
                    try:
                        quantity_remaining = max(0, int(qa) - int(qs))
                    except (TypeError, ValueError):
                        quantity_remaining = None
            active_offers_payload.append({
                "id": o.get("id"),
                "title": o.get("title") or "",
                "price_usd": price_val,
                "quantity_remaining": quantity_remaining,
                # Marks the pinned/featured offer so the host-side
                # product stack + modal carousel can highlight it
                # without a second lookup against pinned_offer_id.
                "pinned": bool(pinned_offer_id and o.get("id") == pinned_offer_id),
            })
    except Exception:
        active_offers_payload = []

    # Stale-heartbeat auto-clear. If the project row claims
    # is_live=true but the host hasn't checked in within
    # HEARTBEAT_STALE_AFTER_SECONDS, the host has almost
    # certainly disconnected without firing /end-stage (tab
    # close, laptop sleep, network drop). Flip is_live=false
    # in the DB once (dedup via mark_stale_cleared so
    # subsequent reads skip the redundant UPDATE) and return
    # the corrected state in this response so the bubble +
    # Discover render offline immediately.
    is_live_effective = bool(row.get("is_live"))
    if is_live_effective:
        try:
            from services.live_limits import (
                is_heartbeat_stale,
                mark_stale_cleared,
                was_stale_cleared,
                clear_stream,
            )
            if is_heartbeat_stale(row["id"]) and not was_stale_cleared(row["id"]):
                # IVS orphan-stage cleanup (see _delete_orphan_ivs_stage).
                _delete_orphan_ivs_stage(supabase, row["id"])
                # Phase 0 telemetry — see list_public_projects above.
                from services.stream_telemetry import on_stream_end
                on_stream_end(supabase, row["id"], "stale_heartbeat")
                try:
                    supabase.table("projects").update({
                        "is_live": False,
                        "ivs_stage_arn": None,
                        "ivs_stage_id": None,
                    }).eq("id", row["id"]).eq("is_live", True).execute()
                except Exception:
                    pass
                clear_stream(row["id"])
                mark_stale_cleared(row["id"])
                is_live_effective = False
        except Exception:
            # Soft fail — the helper module shouldn't take down
            # embed-config under any circumstances.
            pass

    # Live-session countdown — exposes the per-stream duration cap
    # (services/live_limits.MAX_STREAM_DURATION_MINUTES) so the
    # host-page bubble can paint an honest "live deal ends in
    # MM:SS" timer. In-process state: if the API restarts mid-
    # stream the timer resets to the full cap for visitors who
    # land after the restart. That's acceptable degradation —
    # the cap is a real product constraint, not a fake urgency.
    live_session_payload: dict | None = None
    if is_live_effective:
        try:
            from services.live_limits import (
                get_stream_remaining_seconds,
                get_viewer_count,
            )
            remaining = int(get_stream_remaining_seconds(row["id"]))
            viewers = int(get_viewer_count(row["id"]))
            if remaining > 0 or viewers > 0:
                live_session_payload = {
                    "remaining_seconds": remaining,
                    "viewer_count": viewers,
                }
        except Exception:
            live_session_payload = None

    return {
        # Bump on every shape change so a `curl ... | grep
        # schema_version` from the merchant side confirms which
        # backend code is actually serving the request — catches
        # stale Railway deploys without having to walk every key.
        "schema_version": "v1.7",
        "id": row["id"],
        "slug": row.get("slug"),
        "embed_display_mode": row.get("embed_display_mode") or "automatic",
        # Effective is_live after heartbeat-staleness check —
        # not the raw DB value. Stale broadcasts auto-clear above.
        "is_live": is_live_effective,
        "live_provider": row.get("live_provider"),
        "ivs_stage_arn": row.get("ivs_stage_arn"),
        "pinned_offer_id": pinned_offer_id,
        # Display-only pin countdown deadline (ISO8601 or null). The embed
        # renders an urgency timer until this instant; nothing about price
        # or availability changes when it passes.
        "pinned_until": row.get("pinned_until"),
        "pinned_offer": pinned_offer_payload,
        "active_offers": active_offers_payload,
        "live_session": live_session_payload,
        # Pop-in seller payload. Keys mirror migration 038's allow-list
        # (see _POPIN_ALLOWED_KEYS) so embed.js can render the floating
        # greeting without a second API call. Unknown keys are dropped
        # on write upstream; we forward only the known shape here.
        "popin_config": {
            "enabled": bool(popin_raw.get("enabled", True)),
            "greeting": popin_raw.get("greeting") or "",
            "returning_greeting": popin_raw.get("returning_greeting") or "",
            "delay_seconds": _coerce_delay_seconds(popin_raw.get("delay_seconds")),
            "once_per_session": bool(popin_raw.get("once_per_session", False)),
            "offer_id": popin_raw.get("offer_id"),
            "mode": popin_raw.get("mode") or "bubble",
            "video_url": popin_raw.get("video_url"),
        },
    }


def _coerce_delay_seconds(value) -> int:
    """Clamp the merchant-supplied delay into [0, 60]. Defaults to 0
    when the value is missing, non-numeric, or out of range — that way
    a malformed write doesn't strand the embed waiting forever."""
    try:
        n = int(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0
    if n < 0:
        return 0
    if n > 60:
        return 60
    return n


# -----------------------------
# Partial update project fields (owner only)
# -----------------------------

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    token_utility: Optional[str] = None
    promo_copy: Optional[str] = None
    store_items: Optional[list] = None
    # DUM Pop-In Seller merchant settings. Free-form JSONB on the row;
    # the API validates the small shape it knows about and rejects any
    # display mode outside the active allow-list (_POPIN_ACTIVE_MODES).
    popin_config: Optional[dict] = None
    # How DUM Club appears on the merchant's own website. One of
    # bubble / full / automatic. Gated by _EMBED_DISPLAY_MODES below.
    embed_display_mode: Optional[str] = None
    # Next scheduled go-live timestamp (ISO 8601, TIMESTAMPTZ in DB).
    # Drives the "Going live..." storefront banner. NULL clears the
    # schedule. Migration 064.
    scheduled_live_at: Optional[str] = None
    # Merchant opt-in: after scheduled_live_at passes, the
    # schedule_rollforward cron auto-advances by +7 days.
    # Migration 066.
    recurring_weekly: Optional[bool] = None
    # Canonical category from the seeded categories table (mig 035).
    # FK constraint at DB level rejects unknown values, so the
    # frontend dropdown only offers the 12 seeded ids. Existing
    # `if v is not None` filter below handles persistence; clear-to-
    # null is intentionally not exposed in v1 (set-only).
    category_id: Optional[str] = None


# Allow-list of fields the popin_config payload may contain. Unknown
# keys are silently dropped on write to keep the JSONB clean for the
# embed reader. Display mode is gated by _POPIN_ACTIVE_MODES below —
# any forged value outside that set is rejected server-side.
_POPIN_ALLOWED_KEYS = {
    "enabled",
    "greeting",
    "returning_greeting",
    "delay_seconds",
    "once_per_session",
    "offer_id",
    "mode",
    "video_url",
}
# All four display modes are now wired client-side. "live" points the
# Pop-In bubble at the existing IVS hero viewer (no second Stage join);
# "auto" picks live -> recorded -> bubble per merchant state.
_POPIN_ACTIVE_MODES = {"bubble", "recorded", "live", "auto"}

# Outer embed display mode (migration 040). Controls how DUM Club
# appears on the merchant's own website when they paste the embed
# script. Distinct from _POPIN_ACTIVE_MODES which controls the
# floating greeting bubble INSIDE the iframe.
_EMBED_DISPLAY_MODES = {"bubble", "full", "automatic"}


def _sanitize_popin_config(raw: dict) -> dict:
    """
    Clamp shape + types on the merchant-supplied popin_config blob.
    Returns a clean dict safe to write straight into JSONB. Caller
    is responsible for triggering 400s on hard-invalid input
    (only the mode field rejects on bad values; everything else is
    silently coerced / dropped).
    """
    if not isinstance(raw, dict):
        return {}
    cleaned: dict = {}
    for k, v in raw.items():
        if k not in _POPIN_ALLOWED_KEYS:
            continue
        if k == "enabled" or k == "once_per_session":
            cleaned[k] = bool(v)
        elif k == "greeting" or k == "returning_greeting":
            if v is None:
                continue
            s = str(v).strip()
            if s:
                cleaned[k] = s[:280]  # one-tweet cap to keep the bubble compact
        elif k == "delay_seconds":
            try:
                n = int(v)
            except Exception:
                continue
            cleaned[k] = max(0, min(60, n))  # 0..60s window
        elif k == "offer_id":
            if v is None or v == "":
                cleaned[k] = None
            else:
                cleaned[k] = str(v)
        elif k == "video_url":
            # Empty / null clears the override → bubble mode falls back
            # to the static avatar even if mode is "recorded".
            if v is None or v == "":
                cleaned[k] = None
                continue
            s = str(v).strip()
            if not s:
                cleaned[k] = None
                continue
            # Allow only http / https. Reject javascript: data: file:
            # and other XSS / local-file vectors. Cap at 2048 chars,
            # which is well past any sane CDN URL.
            lo = s.lower()
            if not (lo.startswith("http://") or lo.startswith("https://")):
                raise HTTPException(
                    status_code=400,
                    detail="Pop-In video_url must be an http(s) URL.",
                )
            if len(s) > 2048:
                raise HTTPException(
                    status_code=400,
                    detail="Pop-In video_url is too long (max 2048 chars).",
                )
            cleaned[k] = s
        elif k == "mode":
            mode = str(v).strip().lower() if v is not None else "bubble"
            if mode not in _POPIN_ACTIVE_MODES:
                # Reject explicitly so the UI can show a clear error
                # if someone tries to forge a coming-soon mode.
                raise HTTPException(
                    status_code=400,
                    detail=f"Pop-In mode '{mode}' is not available yet.",
                )
            cleaned[k] = mode
    return cleaned


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    x_owner_id: Optional[str] = Header(None),
):
    """Update allowed project fields. Owner only."""
    supabase = get_client()

    # Resolve slug-or-UUID to the canonical projects.id before any
    # .eq("id", ...) below — the storefront forwards the URL param (a
    # slug, e.g. "topgun-maintenance"), which would otherwise hit
    # Postgres 22P02 against the uuid column. Mirrors the offers-create
    # fix; reassigning project_id makes every downstream query use the
    # canonical UUID.
    resolved_pid = resolve_project_uuid(supabase, project_id)
    if not resolved_pid:
        raise HTTPException(status_code=404, detail="Project not found")
    project_id = resolved_pid

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

    if x_owner_id:
        # 3-way ownership match, verbatim from _set_publication_status.
        # The prior check compared only `_resolve_owner_uuid(...) ==
        # owner_id`, which rejected wallet-less email/Google merchants:
        # _resolve_owner_uuid bridges privy -> users.wallet_address ->
        # profiles.id, so a NULL wallet returns None and the compare
        # fails even though the account legitimately owns the row via
        # privy_id. The listing + publish endpoints already admit by
        # privy_id; this aligns update with them so "can see it" implies
        # "can edit it". Admits more legitimate owners, rejects no one
        # the old check accepted.
        resolved_owner = _resolve_owner_uuid(supabase, x_owner_id)
        owner_match = (
            (project.get("owner_id") and project["owner_id"] == x_owner_id)
            or (project.get("owner_id") and resolved_owner and project["owner_id"] == resolved_owner)
            or (project.get("privy_id") and project["privy_id"] == x_owner_id)
        )
        if not owner_match:
            raise HTTPException(status_code=403, detail="Not the project owner")

    updates = {k: v for k, v in body.dict().items() if v is not None}

    # DUM Pop-In Seller config: sanitize before persistence. We MUST
    # do this even when popin_config is non-None but `{}` — a merchant
    # clearing all overrides should be allowed to write an empty
    # object back (i.e. "go back to defaults").
    if "popin_config" in updates:
        updates["popin_config"] = _sanitize_popin_config(updates["popin_config"])

    # Outer embed display mode allow-list. Reject anything outside
    # {bubble, full, automatic} so a forged payload can't slip a
    # garbage string past the DB CHECK constraint.
    if "embed_display_mode" in updates:
        mode = str(updates["embed_display_mode"]).strip().lower()
        if mode not in _EMBED_DISPLAY_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"embed_display_mode must be one of {sorted(_EMBED_DISPLAY_MODES)}",
            )
        updates["embed_display_mode"] = mode

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
# Publish / unpublish storefront
# -----------------------------
# Publishing is the merchant-facing "open my store" switch: it flips
# projects.status draft <-> live. This is deliberately separate from
# going live (is_live / broadcasting) — a store can be published with
# the stream off, and a merchant can broadcast a draft store. Before
# this endpoint the only path to status='live' was the deprecated
# Solana token pipeline (advance-token-status), which left normal
# merchants with no way to publish. Buyability is governed by
# visibility (public by default), not status, so a published store is
# shoppable whether or not a stream is running; publishing is what
# lists it on /discover and flips the owner's Store Status card to the
# published state.
#
# Status is intentionally NOT exposed through the generic PATCH
# /{project_id} whitelist: that endpoint's ownership check is optional
# (only runs when x_owner_id is sent), and publish/unpublish is too
# high-stakes to leave un-gated. These endpoints require the caller's
# privy id in the user_id header and verify ownership the same way
# /go-live does.


async def _set_publication_status(project_id: str, user_id: str, *, publish: bool):
    """Owner-gated flip of projects.status between 'live' and 'draft'.

    Publish path (PR 5, owner D4): gated on description >=20 chars +
    at least one active offer + Stripe Connect verified. When all
    gates pass, atomically flips status='live', review_status='approved',
    verified=True, is_verified=True — mirrors PR #364's founding
    override so a self-serve publisher lands on /discover Pass 1 + 2
    the same way a founder does.

    Unpublish path: always allowed for the owner (no gates) — a
    merchant can pull their storefront back to draft at any time.
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    supabase = get_client()

    # Resolve slug-or-UUID to the canonical projects.id (publish/unpublish
    # are called from the storefront with the URL param, which is a slug
    # for slug-addressable storefronts -> Postgres 22P02 otherwise).
    resolved_pid = resolve_project_uuid(supabase, project_id)
    if not resolved_pid:
        raise HTTPException(status_code=404, detail="Project not found")
    project_id = resolved_pid

    project_res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id, status, review_status, description")
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

    # A 'rejected' project is a moderation decision, not a draft —
    # refuse to publish it rather than silently overriding the review.
    current = (project.get("status") or "draft").strip()
    if publish and current == "rejected":
        raise HTTPException(
            status_code=400,
            detail="This store can't be published. Contact support if you think this is a mistake.",
        )

    if publish:
        # Self-serve publish gates (owner D4 doctrine, PR 5). Each gate
        # is checked independently so the user-visible 400 detail names
        # every missing requirement, not just the first one.
        missing: list[str] = []

        # Gate 1: description >= 20 chars. Mirrors filters.ts:97 and
        # the discovery filter shipped in PR #367.
        desc = (project.get("description") or "").strip()
        if len(desc) < 20:
            missing.append("add a description of at least 20 characters")

        # Gate 2: at least one active offer.
        try:
            offers_res = (
                supabase.table("offers")
                .select("id", count="exact")
                .eq("project_id", project_id)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            offer_count = offers_res.count or 0
        except Exception:
            offer_count = 0
        if offer_count < 1:
            missing.append("add at least one offer")

        # Gate 3: Stripe Connect verified on the owner's merchant row.
        # Conservative on lookup failure: treat as unverified. The
        # missing-message distinguishes "never started Stripe" from
        # "started but Stripe is still reviewing" so the merchant knows
        # whether to take an action or just wait.
        stripe_verified = False
        stripe_status_value = ""
        owner_privy = project.get("privy_id") or user_id
        try:
            merchant_res = (
                supabase.table("merchants")
                .select("stripe_connect_status")
                .eq("owner_privy_id", owner_privy)
                .limit(1)
                .execute()
            )
            if merchant_res.data:
                stripe_status_value = merchant_res.data[0].get("stripe_connect_status") or ""
                stripe_verified = stripe_status_value == "verified"
        except Exception:
            pass
        if not stripe_verified:
            if stripe_status_value in ("", "not_connected"):
                missing.append("connect your Stripe payment account")
            else:
                missing.append(
                    "wait for Stripe to finish checking your account, then check back shortly"
                )

        if missing:
            detail = (
                "Your storefront isn't ready to publish yet. To publish, "
                + ", and ".join(missing)
                + "."
            )
            raise HTTPException(status_code=400, detail=detail)

        # All gates passed — atomic 5-field flip to live + approved +
        # verified + visibility=public. Same row state PR #364 sets for
        # founders at signup PLUS visibility alignment so the dashboard
        # "Storefront published" badge actually matches /discover state
        # (previously the row could be live+approved but visibility=hidden
        # — invisible on /discover while the dashboard claimed it was up).
        # Idempotent: re-publishing an already-public row is a no-op.
        supabase.table("projects").update({
            "status": "live",
            "review_status": "approved",
            "verified": True,
            "is_verified": True,
            "visibility": "public",
        }).eq("id", project_id).execute()
        return {"status": "success", "published": True, "project_status": "live"}

    # Unpublish path — no gates beyond owner-check. Flips status AND
    # visibility together so unpublishing fully removes the row from
    # /discover (status='draft' alone is not enough — the discovery
    # query also gates on visibility='public'). review_status and
    # verified are preserved so re-publishing later doesn't require
    # operator re-approval.
    supabase.table("projects").update({
        "status": "draft",
        "visibility": "hidden",
    }).eq("id", project_id).execute()
    return {"status": "success", "published": False, "project_status": "draft"}


@router.post("/{project_id}/publish")
async def publish_project(
    project_id: str,
    user_id: str = Header(default="", convert_underscores=False),
):
    """Owner publishes the storefront (status draft -> live)."""
    return await _set_publication_status(project_id, user_id, publish=True)


@router.post("/{project_id}/unpublish")
async def unpublish_project(
    project_id: str,
    user_id: str = Header(default="", convert_underscores=False),
):
    """Owner reverts the storefront to a draft (status live -> draft)."""
    return await _set_publication_status(project_id, user_id, publish=False)


# -----------------------------
# Live Commerce MVP
# -----------------------------

class GoLiveRequest(BaseModel):
    stream_url: Optional[str] = Field(default=None, max_length=500)
    provider: str = Field(default="manual_embed")  # "manual_embed" only; "native_mux" retired (410)

class PinOfferRequest(BaseModel):
    offer_id: Optional[str] = None
    # Display-only pin countdown. When pinning (offer_id set), the seller
    # picks how long the on-screen urgency timer runs. None = pin with no
    # timer (indefinite). Only the allowed values are honored; anything
    # else is treated as no-timer rather than rejected, so a stale client
    # can't 422 a pin. Nothing about price/availability changes at zero.
    duration_minutes: Optional[int] = None


# Seller-selectable pin durations (minutes). Mirrored in the frontend
# picker; the backend is the gate so an out-of-range value can't set an
# arbitrary deadline.
PIN_DURATION_CHOICES = {2, 5, 10, 30, 60}


@router.post("/{project_id}/go-live")
async def go_live(
    project_id: str,
    body: GoLiveRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner toggles stream ON with a stream URL."""
    supabase = get_client()

    # Resolve slug-or-UUID up front so the project fetch + the is_live
    # UPDATE + telemetry all key off the canonical projects.id. The
    # storefront calls /go-live with the URL param (a slug); a bare
    # .eq("id", slug) would Postgres-22P02 even before the provider
    # branch. Mirrors the offers-create fix.
    resolved_pid = resolve_project_uuid(supabase, project_id)
    if not resolved_pid:
        raise HTTPException(status_code=404, detail="Project not found")
    project_id = resolved_pid

    # Overlap the project row + (speculative) merchant Stripe-gate fetches.
    # supabase-py is sync, so push each into a thread and gather. In the
    # common case the caller IS the project owner (their own /go-live),
    # so `user_id` already equals `project.privy_id` and the speculative
    # merchant fetch keyed on user_id is the right one. The edge case
    # (caller authorized via owner_id rather than privy_id) re-fetches
    # the merchant row after the auth check. Net: ~one Supabase
    # round-trip shaved on every Go Live in the common path, with no
    # behavior change.
    def _fetch_project():
        return (
            supabase.table("projects")
            .select("id, owner_id, privy_id")
            .eq("id", project_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

    def _fetch_merchant(privy_id: str):
        return (
            supabase.table("merchants")
            .select("stripe_connect_status")
            .eq("owner_privy_id", privy_id)
            .limit(1)
            .execute()
        )

    project_res, merchant_res = await asyncio.gather(
        asyncio.to_thread(_fetch_project),
        asyncio.to_thread(_fetch_merchant, user_id),
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
    # Speculative-fetch correction: if the caller was authorized via
    # owner_id but their privy_id differs from the project's, the
    # parallel fetch we did was keyed on the wrong privy_id — re-fetch.
    if owner_privy != user_id:
        merchant_res = await asyncio.to_thread(_fetch_merchant, owner_privy)
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

    # Phase 1 cap enforcement — same check as /api/ivs/create-stage.
    # Refuse the go-live if the merchant is at max_concurrent_streams,
    # or if the resolver fails closed on an unset cap (Business / Enterprise
    # without a merchant_plan_limits override).
    from services.merchant_limits import (
        resolve_merchant_limits_by_privy_did,
        check_monthly_hard_block,
        MerchantLimitsUnresolved,
    )
    try:
        limits = resolve_merchant_limits_by_privy_did(
            owner_privy, supabase=supabase,
        )
    except MerchantLimitsUnresolved as exc:
        print(f"[projects] /go-live cap-resolve refused: {exc!r}")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "merchant_limits_unresolved",
                "message": (
                    "Live setup is still finishing for your account. "
                    "Please try again in a moment."
                ),
                "reason": exc.reason,
            },
        )
    # Phase 3a monthly hard-block.
    hard_block_reason = check_monthly_hard_block(limits, supabase=supabase)
    if hard_block_reason:
        print(f"[projects] /go-live monthly hard block: {hard_block_reason}")
        raise HTTPException(
            status_code=429,
            detail={
                "code": "monthly_hard_block",
                "message": (
                    f"You've exceeded the {limits.plan_id} plan's hard-cap monthly "
                    f"viewer-hours. Upgrade your plan or wait until next month to go live again."
                ),
                "tier": limits.plan_id,
                "included_vh": float(limits.max_monthly_viewer_hours),
                "hard_block_multiplier": float(limits.hard_block_multiplier),
                "upgrade_url": "/upgrade",
            },
        )
    try:
        active_streams_res = (
            supabase.table("stream_sessions")
            .select("id", count="exact", head=True)
            .eq("merchant_id", limits.merchant_id)
            .is_("end_at", "null")
            .execute()
        )
        active_stream_count = active_streams_res.count or 0
    except Exception as exc:
        print(f"[projects] /go-live active-stream-count read failed: {exc!r}")
        active_stream_count = 0
    if active_stream_count >= limits.max_concurrent_streams:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "concurrent_stream_cap_reached",
                "message": (
                    f"You already have {active_stream_count} live stream(s) running. "
                    f"Your {limits.plan_id} plan allows up to "
                    f"{limits.max_concurrent_streams} concurrent stream(s)."
                ),
                "tier": limits.plan_id,
                "current": active_stream_count,
                "cap": limits.max_concurrent_streams,
                "upgrade_url": "/upgrade",
            },
        )

    from datetime import datetime, timezone
    update_fields: dict = {
        "is_live": True,
        "live_provider": body.provider,
        # Real broadcast start (migration 084) — same field ivs.py sets on the
        # IVS path. Drives LiveRail most-recently-live ordering + the storefront
        # "Live for H:MM" timer. Not cleared on end (next go-live overwrites).
        "live_started_at": datetime.now(timezone.utc).isoformat(),
        # Bump updated_at so the Phase 0 startup sweep's NULL-heartbeat /
        # old-updated_at heuristic doesn't clip this brand-new stream
        # before the first /api/ivs/heartbeat poll writes last_heartbeat_at.
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if body.provider == "native_mux":
        # Mux isolation: the native_mux provider was retired after IVS
        # Real-Time was confirmed as the only provider running in prod
        # (13/13 stream_sessions). Explicit 410 instead of silently
        # treating the request as manual_embed, so any stale client or
        # direct API caller gets an actionable error.
        raise HTTPException(
            status_code=410,
            detail={
                "code": "provider_retired",
                "message": (
                    "Live video streaming now runs on the in-browser "
                    "Go Live flow. Open your storefront and tap Go Live."
                ),
            },
        )
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

    # Phase 0 telemetry — best-effort INSERT into stream_sessions.
    from services.stream_telemetry import on_stream_start
    on_stream_start(
        supabase,
        project_id=project_id,
        owner_privy_id=project.get("privy_id") or user_id,
        provider=body.provider,
        stage_arn=None,
    )

    # Notify "remind me when live" subscribers that the show has started.
    # Fire-and-forget + best-effort (see the IVS /create-stage hook). Same
    # atomic sent_at claim as the scheduled cron, so no double-sends.
    try:
        import threading
        from services.agents.live_reminders import notify_project_live_now
        threading.Thread(
            target=notify_project_live_now,
            args=(project_id,),
            daemon=True,
        ).start()
    except Exception as exc:
        print(f"[projects] live-now notify dispatch failed (ignored): {exc!r}")

    result: dict = {"status": "success", "is_live": True, "provider": body.provider}
    return result


@router.post("/{project_id}/end-live")
async def end_live(
    project_id: str,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner ends the live stream."""
    supabase = get_client()

    # Resolve slug-or-UUID before the owner fetch + clear-live UPDATE —
    # storefront calls /end-live with the URL param (a slug) -> 22P02
    # otherwise. Mirrors the offers-create fix.
    resolved_pid = resolve_project_uuid(supabase, project_id)
    if not resolved_pid:
        raise HTTPException(status_code=404, detail="Project not found")
    project_id = resolved_pid

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

    # Phase 0 telemetry — close the stream_sessions row before the
    # clear-live update. Helper is best-effort; never blocks.
    from services.stream_telemetry import on_stream_end
    on_stream_end(supabase, project_id, "manual")

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
async def get_live_status(project_id: str, response: Response):
    """Public endpoint: returns live provider info, stream health,
    and in-memory live-presence signals (viewer_count +
    remaining_seconds).

    Also serves as the Vercel embed-config shim's source for
    Railway-only fields, so CORS is opened to "*" and the
    response is cached for 10s. Cross-origin reachability is
    required because the dum.club Next.js route handler calls
    this endpoint during a server-rendered request to enrich
    the embed-config payload with live presence.
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Cache-Control"] = "public, max-age=10"

    supabase = get_client()
    res = (
        supabase.table("projects")
        .select("id, is_live, live_provider, live_playback_id, live_stream_id, stream_url")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = res.data[0]
    # Same heartbeat-staleness check as /embed-config. /live-status
    # is the Vercel shim's source for in-process presence so a
    # stale flag here would echo "is_live: true, viewer_count: 0"
    # downstream and read as "Live Business but nobody watching".
    is_live_effective = bool(project.get("is_live", False))
    if is_live_effective:
        try:
            from services.live_limits import (
                is_heartbeat_stale,
                mark_stale_cleared,
                was_stale_cleared,
                clear_stream,
            )
            if is_heartbeat_stale(project["id"]) and not was_stale_cleared(project["id"]):
                # IVS orphan-stage cleanup (see _delete_orphan_ivs_stage).
                _delete_orphan_ivs_stage(supabase, project["id"])
                # Phase 0 telemetry — see list_public_projects above.
                from services.stream_telemetry import on_stream_end
                on_stream_end(supabase, project["id"], "stale_heartbeat")
                try:
                    supabase.table("projects").update({
                        "is_live": False,
                        "ivs_stage_arn": None,
                        "ivs_stage_id": None,
                    }).eq("id", project["id"]).eq("is_live", True).execute()
                except Exception:
                    pass
                clear_stream(project["id"])
                mark_stale_cleared(project["id"])
                is_live_effective = False
        except Exception:
            pass

    result = {
        "is_live": is_live_effective,
        "provider": project.get("live_provider"),
        "playback_id": project.get("live_playback_id"),
        "stream_url": project.get("stream_url"),
        # Live-presence signals from the in-process trackers in
        # services/live_limits.py. Both default to 0 when the
        # project isn't broadcasting or the trackers haven't
        # been populated (Railway restart, etc.).
        "viewer_count": 0,
        "remaining_seconds": 0,
    }

    try:
        from services.live_limits import (
            get_viewer_count,
            get_stream_remaining_seconds,
        )
        result["viewer_count"] = int(get_viewer_count(project["id"]))
        # Only expose remaining_seconds when the project is
        # actually live — get_stream_remaining_seconds returns the
        # full cap (3600) for unknown project_ids, which would
        # surface as "60:00 countdown" on offline projects.
        if is_live_effective:
            result["remaining_seconds"] = int(
                get_stream_remaining_seconds(project["id"])
            )
    except Exception:
        # Soft-fail — defaults already in result.
        pass

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

    # Display-only pin countdown deadline. Set only when pinning (offer_id
    # present) with an allowed duration; cleared on unpin or no-timer pin.
    # Stored as an ISO8601 UTC timestamp so PostgREST writes the TIMESTAMPTZ
    # column directly.
    pinned_until = None
    if body.offer_id and body.duration_minutes in PIN_DURATION_CHOICES:
        pinned_until = (
            datetime.now(timezone.utc) + timedelta(minutes=body.duration_minutes)
        ).isoformat()

    supabase.table("projects").update({
        "pinned_offer_id": body.offer_id,
        "pinned_until": pinned_until,
    }).eq("id", project_id).execute()

    return {
        "status": "success",
        "pinned_offer_id": body.offer_id,
        "pinned_until": pinned_until,
    }
