from fastapi import APIRouter, HTTPException, Header, Query, Response
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime, timezone
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
            try:
                supabase.table("projects").update({
                    "is_live": False,
                }).eq("id", p["id"]).eq("is_live", True).execute()
            except Exception:
                pass
            if clear_stream:
                clear_stream(p["id"])
            if mark_stale_cleared:
                mark_stale_cleared(p["id"])
            p["is_live"] = False
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
                "ivs_stage_arn, pinned_offer_id, popin_config"
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
                try:
                    supabase.table("projects").update({
                        "is_live": False,
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
                try:
                    supabase.table("projects").update({
                        "is_live": False,
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
