"""
Offers CRUD — structured items available for purchase on a project.
Separate from store_items JSONB (which remains untouched).
"""
import re
import time
from fastapi import APIRouter, File, Form, HTTPException, Depends, UploadFile
from pydantic import BaseModel, Field
from typing import Optional
from decimal import Decimal

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


# ── PostgREST filter sanitizer ─────────────────────────────────
#
# `.or_()` / `.ilike()` in the Supabase Python SDK pass their filter
# value as a raw string in the URL query. PostgREST uses ',' '(' ')'
# '"' as filter delimiters, and SQL LIKE treats '%' and '_' as
# wildcards. To prevent a search query from breaking the filter
# parser or smuggling in extra clauses, we strip everything except
# a conservative safe set (alphanumerics, whitespace, hyphens,
# apostrophes, periods) and cap length.
_SAFE_Q_CHARS = re.compile(r"[^\w\s\-'.]", re.UNICODE)


def _sanitize_q(q: Optional[str]) -> str:
    if not q:
        return ""
    cleaned = _SAFE_Q_CHARS.sub(" ", q)
    cleaned = " ".join(cleaned.split())
    return cleaned[:80]


# ── Models ────────────────────────────────────────────────────

class OfferCreate(BaseModel):
    project_id: str
    title: str
    description: Optional[str] = None
    price_usd: float = Field(gt=0)
    # Optional "was" price for a strikethrough on the live/offer card. Only
    # meaningful when greater than price_usd; the UI hides it otherwise.
    # Requires the offers.compare_at_price column (added by hand-applied
    # migration); only persisted when set, so this is safe before that lands.
    compare_at_price: Optional[float] = Field(default=None, gt=0)
    offer_type: str  # 'digital_service' | 'physical_product'
    delivery_info: Optional[str] = None
    token_discount_percent: int = Field(default=0, ge=0, le=100)
    primary_image_url: Optional[str] = None
    video_url: Optional[str] = None
    quantity_available: Optional[int] = None
    unlimited_inventory: bool = True
    # Canonical category from the seeded categories table (mig 035).
    # FK constraint at DB rejects unknown values, but the dashboard
    # dropdown only emits the 12 seeded ids — so the 500 path is
    # unreachable from the UI. Set-only in v1 (no clear affordance).
    category_id: Optional[str] = None


class OfferUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price_usd: Optional[float] = Field(default=None, gt=0)
    # See OfferCreate.compare_at_price. Picked up by the `if v is not None`
    # update filter below, so it only writes when the merchant set a value.
    compare_at_price: Optional[float] = Field(default=None, gt=0)
    offer_type: Optional[str] = None
    delivery_info: Optional[str] = None
    token_discount_percent: Optional[int] = Field(default=None, ge=0, le=100)
    is_active: Optional[bool] = None
    primary_image_url: Optional[str] = None
    video_url: Optional[str] = None
    quantity_available: Optional[int] = None
    unlimited_inventory: Optional[bool] = None
    # See OfferCreate.category_id. The update path picks this up via
    # the existing `updates = {k: v for k, v in body.dict().items()
    # if v is not None}` filter further down — no extra wiring.
    category_id: Optional[str] = None


VALID_OFFER_TYPES = {"digital_service", "physical_product"}


# ── Helpers ───────────────────────────────────────────────────

def _get_project_owner(supabase, project_id: str) -> str:
    """Return owner_id for a project, or raise 404.

    Accepts a project UUID OR slug. The frontend forwards the storefront
    URL param verbatim (e.g. "topgun-maintenance"), so a slug reaching a
    bare `.eq("id", slug)` against the uuid column makes Postgres raise
    22P02 (invalid input syntax for type uuid) -> 500 on every offer
    create-by-slug. Resolve to the canonical UUID first (try-UUID-then-
    slug) so both UUID and slug callers work.
    """
    from api.routes.projects import resolve_project_uuid  # lazy: avoid import cycle
    resolved = resolve_project_uuid(supabase, project_id)
    if not resolved:
        raise HTTPException(status_code=404, detail="Project not found")
    res = (
        supabase.table("projects")
        .select("owner_id")
        .eq("id", resolved)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    return res.data[0].get("owner_id")


def _resolve_privy_to_owner(supabase, privy_id: str) -> Optional[str]:
    """Resolve a Privy ID to the profiles.id (owner UUID)."""
    user_res = (
        supabase.table("users")
        .select("wallet_address")
        .eq("privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not user_res.data:
        return None
    wallet = user_res.data[0].get("wallet_address")
    if not wallet:
        return None
    profile_res = (
        supabase.table("profiles")
        .select("id")
        .eq("wallet_address", wallet)
        .limit(1)
        .execute()
    )
    if not profile_res.data:
        return None
    return profile_res.data[0].get("id")


def _verify_project_owner(supabase, project_id: str, privy_id: str):
    """Raise 403 if the privy user is not the project owner."""
    owner_id = _get_project_owner(supabase, project_id)
    resolved = _resolve_privy_to_owner(supabase, privy_id)
    if resolved != owner_id:
        raise HTTPException(status_code=403, detail="Not the project owner")


_STRIPE_NOT_VERIFIED_DETAIL = {
    "code": "merchant_stripe_not_verified",
    "message": (
        "Stripe onboarding is not complete yet. "
        "Finish Stripe verification before accepting live payments."
    ),
}


def _assert_merchant_stripe_verified(supabase, privy_id: str) -> None:
    """
    Raise 403 unless the merchant's Stripe Connect account is fully
    verified. Reads the cached merchants.stripe_connect_status; the
    column is kept fresh by the account.updated webhook in checkout.py
    and the write-through in /merchant/stripe-connect/status.
    """
    res = (
        supabase.table("merchants")
        .select("stripe_connect_status")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    status = res.data[0].get("stripe_connect_status") if res.data else None
    if status != "verified":
        print(
            f"[offers] Refusing publish: merchant={privy_id} "
            f"stripe_connect_status={status!r}"
        )
        raise HTTPException(
            status_code=403,
            detail=_STRIPE_NOT_VERIFIED_DETAIL,
        )


# ── Routes ────────────────────────────────────────────────────

@router.post("/create")
async def create_offer(
    body: OfferCreate,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_client()
    privy_id = current_user.get("sub")
    print(f"[offers] CREATE request: project={body.project_id}, title='{body.title}', price={body.price_usd}, type={body.offer_type}, privy={privy_id}")

    if body.offer_type not in VALID_OFFER_TYPES:
        print(f"[offers] CREATE rejected: invalid offer_type '{body.offer_type}'")
        raise HTTPException(
            status_code=400,
            detail=f"offer_type must be one of: {', '.join(VALID_OFFER_TYPES)}",
        )

    # Resolve slug-or-UUID to the canonical projects.id UUID ONCE. The
    # storefront owner UI posts the URL param (a slug, e.g.
    # "topgun-maintenance"); we must use the UUID for BOTH the owner
    # check AND the insert into offers.project_id (a uuid FK) — inserting
    # the raw slug would also raise Postgres 22P02. 404 if unresolvable.
    from api.routes.projects import resolve_project_uuid  # lazy: avoid import cycle
    project_uuid = resolve_project_uuid(supabase, body.project_id)
    if not project_uuid:
        raise HTTPException(status_code=404, detail="Project not found")

    _verify_project_owner(supabase, project_uuid, privy_id)
    print(f"[offers] CREATE: owner verified for project={project_uuid}")

    # Stripe gate REMOVED from creation (browser audit 2026-07-03):
    # requiring SSN/bank before the first offer was the heaviest ask at
    # the most fragile moment, and Whatnot sequences it after. Merchants
    # now build + preview their whole catalog first. Publishing the
    # storefront and checkout both still require verified Stripe, so a
    # buyer can never reach an unpayable shop.

    insert = {
        "project_id": project_uuid,
        "title": body.title.strip(),
        "description": (body.description or "").strip() or None,
        "price_usd": float(body.price_usd),
        "offer_type": body.offer_type,
        "delivery_info": (body.delivery_info or "").strip() or None,
        "token_discount_percent": body.token_discount_percent,
        "primary_image_url": (body.primary_image_url or "").strip() or None,
        "video_url": (body.video_url or "").strip() or None,
        "quantity_available": body.quantity_available,
        "quantity_sold": 0,
        "unlimited_inventory": body.unlimited_inventory,
        "is_active": True,
        # NULL when the merchant didn't pick a category. /discover offer
        # tiles cascade through the parent project's resolver (#348),
        # so a NULL-category offer still renders a meaningful pill.
        "category_id": body.category_id,
    }
    # Only reference compare_at_price when the merchant set one, so offers
    # created before the column-adding migration lands never touch it.
    if body.compare_at_price is not None:
        insert["compare_at_price"] = float(body.compare_at_price)

    try:
        res = supabase.table("offers").insert(insert).execute()
    except Exception as db_err:
        print(f"[offers] CREATE DB ERROR: {type(db_err).__name__}: {db_err}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(db_err)}")

    if not res.data:
        print(f"[offers] CREATE failed: insert returned no data")
        raise HTTPException(status_code=500, detail="Failed to create offer — no data returned from database")

    print(f"[offers] CREATE success: id={res.data[0].get('id')}, title='{res.data[0].get('title')}'")
    return res.data[0]


@router.get("/search")
async def search_offers(q: str = "", limit: int = 20):
    """Public full-text-ish search over active offers.

    Returns offers whose title or description contains the query
    string (case-insensitive), joined to their parent project to
    include the project name and slug for linking back. Only active
    offers on approved, non-deleted projects are returned.

    This endpoint powers the "Items for Sale" section on /discover —
    which previously read from project.store_items JSONB (empty for
    Topgun). Now it reads from the real offers table so Topgun's
    6 aviation services (seeded via migration 031) surface properly.

    Query params:
      q:     search string, sanitized to [\\w\\s\\-'.]+, max 80 chars
      limit: result cap, default 20, clamped to [1, 50]

    Returns: JSON array of offer rows with flattened project fields.
    Empty array on empty query or on any DB error (search must never
    500 the discover page).

    Route ordering: this MUST stay above GET /{project_id} or FastAPI
    will match 'search' as a project_id and return 500.
    """
    q_clean = _sanitize_q(q)
    if not q_clean:
        return []

    try:
        limit_int = max(1, min(int(limit or 20), 50))
    except (TypeError, ValueError):
        limit_int = 20

    supabase = get_client()

    try:
        # Inner join to projects via PostgREST embedded resources so
        # we get name/slug/review_status/is_deleted in one round trip.
        # !inner gates rows where the project join doesn't match.
        res = (
            supabase.table("offers")
            .select(
                "id, title, description, price_usd, primary_image_url, category_id, "
                "is_active, created_at, project_id, "
                "projects!inner(name, slug, review_status, is_deleted, "
                "category_id, description, template_type)"
            )
            .eq("is_active", True)
            .eq("projects.review_status", "approved")
            .eq("projects.is_deleted", False)
            .or_(f"title.ilike.*{q_clean}*,description.ilike.*{q_clean}*")
            .order("created_at", desc=True)
            .limit(limit_int)
            .execute()
        )
    except Exception as exc:
        print(f"[offers] search q='{q_clean}' failed: {exc!r}")
        return []

    # Flatten the embedded project into top-level fields so the
    # frontend consumer doesn't have to deal with nested shapes.
    # Per-offer category badge dual-pathway resolution (parallel to
    # #341 / #347): the frontend prefers offers.category_id, then
    # falls back to the parent project's resolved label via the
    # projects.{category_id, description, template_type} fields below.
    results = []
    for row in (res.data or []):
        proj = row.get("projects") or {}
        results.append({
            "id": row.get("id"),
            "title": row.get("title"),
            "description": row.get("description"),
            "price_usd": row.get("price_usd"),
            "primary_image_url": row.get("primary_image_url"),
            "is_active": row.get("is_active"),
            "created_at": row.get("created_at"),
            "project_id": row.get("project_id"),
            "project_name": proj.get("name"),
            "project_slug": proj.get("slug"),
            # Per-offer category badge dual-pathway support.
            "category_id": row.get("category_id"),
            "project_category_id": proj.get("category_id"),
            "project_description": proj.get("description"),
            "project_template_type": proj.get("template_type"),
        })

    print(f"[offers] search q='{q_clean}' limit={limit_int}: {len(results)} results")
    return results


@router.get("/{project_id}")
async def list_offers(project_id: str):
    supabase = get_client()

    try:
        res = (
            supabase.table("offers")
            .select("*")
            .eq("project_id", project_id)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as db_err:
        print(f"[offers] LIST DB ERROR for project={project_id}: {type(db_err).__name__}: {db_err}")
        raise HTTPException(status_code=500, detail=f"Database error loading offers")

    print(f"[offers] LIST project={project_id}: {len(res.data or [])} active offers")
    return res.data or []


@router.patch("/{offer_id}")
async def update_offer(
    offer_id: str,
    body: OfferUpdate,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_client()
    privy_id = current_user.get("sub")

    # Platform takedown guard (mig 086): an admin-removed offer cannot
    # be reactivated by the merchant. Everything else about it stays
    # editable so they can fix and appeal.
    if body.is_active is True:
        try:
            flagged = (
                supabase.table("offers")
                .select("admin_removed")
                .eq("id", offer_id)
                .limit(1)
                .execute()
            )
            if flagged.data and flagged.data[0].get("admin_removed"):
                raise HTTPException(
                    status_code=403,
                    detail="This offer was removed by DUM Club and can't be relisted. Contact support.",
                )
        except HTTPException:
            raise
        except Exception as exc:
            print(f"[offers] admin_removed check failed for {offer_id}: {exc!r}")

    # Fetch the offer to find its project
    offer_res = (
        supabase.table("offers")
        .select("id, project_id")
        .eq("id", offer_id)
        .limit(1)
        .execute()
    )
    if not offer_res.data:
        raise HTTPException(status_code=404, detail="Offer not found")

    project_id = offer_res.data[0]["project_id"]
    _verify_project_owner(supabase, project_id, privy_id)

    # (Stripe assert removed here too - see create_offer. Publish +
    # checkout carry the gate.)

    if body.offer_type and body.offer_type not in VALID_OFFER_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"offer_type must be one of: {', '.join(VALID_OFFER_TYPES)}",
        )

    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    supabase.table("offers").update(updates).eq("id", offer_id).execute()

    updated = (
        supabase.table("offers")
        .select("*")
        .eq("id", offer_id)
        .single()
        .execute()
    )
    return updated.data


# ─────────────────────────────────────────────────────────────────────
# Server-mediated offer-image upload — Path 2 hardening sprint PR 1.
#
# Receives an offer's primary image via multipart, validates size +
# MIME + project ownership server-side, then writes to Supabase
# Storage using SUPABASE_SERVICE_KEY (BYPASSRLS). Replaces the
# browser-direct upload at TWO sites — frontend/components/dashboard/
# PostAndGoLive.tsx AND frontend/app/project/[id]/page.tsx — in
# subsequent frontend swap PRs.
#
# Until those swaps land, BOTH paths coexist — the frontend keeps
# writing via the anon-key client through the existing wide-open
# storage policy. This endpoint is additive only.
#
# Mirrors transcribe.py's UploadFile + size-guard shape.
# ─────────────────────────────────────────────────────────────────────


_MAX_OFFER_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
_OFFER_EXT_RE = re.compile(r"^[a-z0-9]{1,5}$")


def _safe_offer_extension(filename: Optional[str], default: str = "jpg") -> str:
    if not filename or "." not in filename:
        return default
    ext = filename.rsplit(".", 1)[-1].lower().strip()
    return ext if _OFFER_EXT_RE.match(ext) else default


@router.post("/upload-image")
async def upload_offer_image(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Server-mediated offer-image upload.

    Form fields:
      project_id: the project the offer belongs to (ownership-gated)
      file: multipart image (image/*, ≤ 5 MB)

    Mirrors the storage layout the browser-direct upload at
    PostAndGoLive.tsx and project/[id]/page.tsx writes today, so
    POST /api/offers/create / PATCH /api/offers/{id} consume the
    returned public_url unchanged.

    Returns: {"public_url": str, "path": str}
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="File must be an image (JPEG, PNG, WebP, GIF).",
        )

    contents = await file.read()
    if len(contents) > _MAX_OFFER_IMAGE_BYTES:
        size_mb = len(contents) / 1024 / 1024
        raise HTTPException(
            status_code=413,
            detail=f"File is too large ({size_mb:.1f}MB). Max 5MB.",
        )

    supabase = get_client()

    # Owner gate — _verify_project_owner already 404s on missing
    # project and 403s on wrong owner. Reused verbatim.
    _verify_project_owner(supabase, project_id, privy_id)

    ext = _safe_offer_extension(file.filename)
    path = f"offer-images/{project_id}/{int(time.time() * 1000)}.{ext}"

    try:
        supabase.storage.from_("offers").upload(
            path=path,
            file=contents,
            file_options={
                "content-type": content_type,
                "cache-control": "3600",
                "upsert": "false",
            },
        )
    except Exception as exc:
        print(f"[upload] offer image upload failed for project={project_id}: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail="Upload failed. Try again.")

    public_url = supabase.storage.from_("offers").get_public_url(path)

    return {"public_url": public_url, "path": path}
