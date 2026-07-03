from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.privy import require_admin
from db.supabase import get_client

router = APIRouter(prefix="/api/admin", tags=["Admin"])


class RejectBody(BaseModel):
    reason: str


class SuspendBody(BaseModel):
    reason: str


class TakedownBody(BaseModel):
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


# ─────────────────────────────────────────────────────────────────────
# Enforcement (mig 086) — kick out a merchant or take down one offer.
# ─────────────────────────────────────────────────────────────────────

@router.post("/merchants/{merchant_id}/suspend")
async def suspend_merchant(merchant_id: str, body: SuspendBody, _admin=Depends(require_admin)):
    """Platform suspension: blocks Go Live + checkout (both already gate
    on is_merchant_suspended) and unpublishes the merchant's storefronts
    so they leave Discover. Reversible via /unsuspend; storefronts stay
    draft until the merchant republishes."""
    supabase = get_client()
    res = (
        supabase.table("merchants")
        .update({
            "admin_suspended": True,
            "admin_suspended_reason": body.reason,
            "admin_suspended_at": "now()",
        })
        .eq("id", merchant_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    privy_id = res.data[0].get("owner_privy_id")
    unpublished = 0
    if privy_id:
        proj = (
            supabase.table("projects")
            .update({"status": "draft", "is_live": False})
            .eq("privy_id", privy_id)
            .eq("is_deleted", False)
            .execute()
        )
        unpublished = len(proj.data or [])
    print(f"[admin] suspended merchant {merchant_id} ({unpublished} storefronts unpublished): {body.reason}")
    return {"success": True, "storefronts_unpublished": unpublished}


@router.post("/merchants/{merchant_id}/unsuspend")
async def unsuspend_merchant(merchant_id: str, _admin=Depends(require_admin)):
    """Clears platform suspension. Storefronts stay draft - the merchant
    republishes themselves, which doubles as their acknowledgement."""
    supabase = get_client()
    res = (
        supabase.table("merchants")
        .update({"admin_suspended": False})
        .eq("id", merchant_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    return {"success": True}


@router.post("/offers/{offer_id}/takedown")
async def takedown_offer(offer_id: str, body: TakedownBody, _admin=Depends(require_admin)):
    """Single-offer removal: deactivates the offer and flags it so the
    merchant cannot relist it (the offers PATCH refuses is_active=true
    while admin_removed). The rest of the shop is untouched."""
    supabase = get_client()
    res = (
        supabase.table("offers")
        .update({
            "is_active": False,
            "admin_removed": True,
            "admin_removed_reason": body.reason,
        })
        .eq("id", offer_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Offer not found")
    print(f"[admin] took down offer {offer_id}: {body.reason}")
    return {"success": True}


@router.post("/offers/{offer_id}/restore")
async def restore_offer(offer_id: str, _admin=Depends(require_admin)):
    """Clears a takedown. Leaves is_active=false - the merchant flips it
    back on themselves."""
    supabase = get_client()
    res = (
        supabase.table("offers")
        .update({"admin_removed": False, "admin_removed_reason": None})
        .eq("id", offer_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Offer not found")
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────
# Phase 3b — overage billing admin endpoints.
# Triggers are operator-driven; nothing here runs on a schedule yet.
# ─────────────────────────────────────────────────────────────────────

@router.post("/overage/{merchant_id}/{yyyymm}")
async def trigger_overage_billing(
    merchant_id: str,
    yyyymm: str,
    _admin=Depends(require_admin),
):
    """Compute + record + (optionally) invoice livestream viewer-hour
    overage for one merchant for one billing month.

    Idempotent: a row already present in merchant_overage_invoices
    for (merchant_id, yyyymm) is returned verbatim with repeated=true.
    Operator may DELETE that row to force a recompute (with caution —
    that erases the audit trail).

    Path params:
        merchant_id: merchants.id UUID
        yyyymm: billing period (e.g. "2026-05")

    Response shape:
        {
          "repeated": bool,
          "row": <merchant_overage_invoices row, all columns>,
          "calculation": {...}   # only when repeated=false
        }
    """
    from services.overage_billing import (
        invoice_overage_for_period,
        OverageBillingError,
    )
    supabase = get_client()
    try:
        result = invoice_overage_for_period(
            merchant_id, yyyymm, supabase=supabase,
        )
    except OverageBillingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # OverageCalculation isn't directly JSON-serialisable (Decimal +
    # dataclass); convert if it's in the payload.
    if "calculation" in result:
        calc = result["calculation"]
        result["calculation"] = {
            "hours_used": str(calc.hours_used),
            "included_vh": str(calc.included_vh),
            "overage_hours": str(calc.overage_hours),
            "overage_rate": str(calc.overage_rate),
            "overage_owed_cents": calc.overage_owed_cents,
            "sales_fee_earned_cents": calc.sales_fee_earned_cents,
            "net_overage_cents": calc.net_overage_cents,
        }
    return result


@router.get("/overage/{merchant_id}")
async def list_overage_history(
    merchant_id: str,
    _admin=Depends(require_admin),
):
    """All historical overage rows for a merchant, ordered by yyyymm desc."""
    supabase = get_client()
    res = (
        supabase.table("merchant_overage_invoices")
        .select("*")
        .eq("merchant_id", merchant_id)
        .order("yyyymm", desc=True)
        .execute()
    )
    return {"rows": res.data or []}


@router.get("/operations/overview")
async def operations_overview(_admin=Depends(require_admin)):
    """One-call operational visibility bundle for the admin operations
    page. Returns small aggregates so the page renders without N
    follow-up calls.

    Sections:
      active_streams       — currently broadcasting projects (end_at IS NULL)
      this_month_usage     — viewer-hours + stream counts for the current
                             YYYY-MM (UTC). Per-merchant rows for cap math.
      cap_warnings         — merchants whose viewer_seconds is >= 70% of
                             their max_monthly_viewer_hours. NULL caps
                             (Business / Enterprise without an override)
                             are skipped — no math to do.
      stripe_fees_30d      — sum of platform_fee_amount over the last 30
                             days of paid orders. Indicates platform
                             take-rate revenue.
      recent_streams_7d    — count of streams that started in the last
                             7 days + count of distinct merchants.

    All queries are read-only against existing tables. Admin-gated; no
    public exposure. Safe to call every few seconds — the heaviest
    aggregate scans an INTEGER column and a sum().
    """
    from datetime import datetime, timezone, timedelta
    supabase = get_client()
    now = datetime.now(timezone.utc)
    yyyymm = now.strftime("%Y-%m")

    # 1. Active streams — partial index makes this fast.
    active_res = (
        supabase.table("stream_sessions")
        .select("id, project_id, merchant_id, provider, start_at, peak_concurrent")
        .is_("end_at", "null")
        .order("start_at", desc=True)
        .limit(50)
        .execute()
    )
    active_streams = active_res.data or []

    # Best-effort project name enrichment (one batch lookup, no N+1).
    proj_ids = sorted({s["project_id"] for s in active_streams if s.get("project_id")})
    proj_lookup: dict = {}
    if proj_ids:
        proj_res = (
            supabase.table("projects")
            .select("id, slug, name, title")
            .in_("id", proj_ids)
            .execute()
        )
        for p in proj_res.data or []:
            proj_lookup[p["id"]] = p
    for s in active_streams:
        proj = proj_lookup.get(s.get("project_id")) or {}
        s["project_name"] = (proj.get("title") or proj.get("name") or "").strip() or None
        s["project_slug"] = proj.get("slug")

    # 2. Current-month usage. Per-merchant rows for cap warnings below.
    usage_res = (
        supabase.table("merchant_monthly_usage")
        .select("merchant_id, viewer_seconds, stream_count")
        .eq("yyyymm", yyyymm)
        .execute()
    )
    usage_rows = usage_res.data or []
    total_viewer_seconds_this_month = sum(int(r.get("viewer_seconds") or 0) for r in usage_rows)
    total_streams_this_month = sum(int(r.get("stream_count") or 0) for r in usage_rows)

    # 3. Cap warnings. Join merchant_plan_limits to flag rows where
    # usage is approaching the monthly cap. Skip rows with NULL caps.
    limits_res = (
        supabase.table("merchant_plan_limits")
        .select("merchant_id, max_monthly_viewer_hours")
        .execute()
    )
    limits_lookup = {r["merchant_id"]: r for r in limits_res.data or []}
    cap_warnings = []
    for r in usage_rows:
        mid = r["merchant_id"]
        lim = limits_lookup.get(mid) or {}
        max_vh = lim.get("max_monthly_viewer_hours")
        if not max_vh or max_vh <= 0:
            continue
        used_hours = int(r.get("viewer_seconds") or 0) / 3600.0
        pct = (used_hours / float(max_vh)) * 100.0
        if pct >= 70.0:
            cap_warnings.append({
                "merchant_id": mid,
                "used_hours": round(used_hours, 1),
                "cap_hours": int(max_vh),
                "pct_of_cap": round(pct, 1),
            })
    cap_warnings.sort(key=lambda x: x["pct_of_cap"], reverse=True)

    # 4. Stripe fees last 30 days. The canonical columns are
    # platform_fee_usd (NUMERIC, dollars — from 010_offers_orders.sql)
    # and amount_paid_usd (NUMERIC, dollars — same migration). An
    # earlier draft of this block selected non-existent columns
    # (platform_fee_amount, amount_usd) and PostgREST returned a 400
    # that surfaced as a 500 on /api/admin/operations/overview, which
    # broke the ops dashboard's Stripe fees card in production.
    thirty_days_ago = (now - timedelta(days=30)).isoformat()
    orders_res = (
        supabase.table("orders")
        .select("platform_fee_usd, amount_paid_usd, status, created_at")
        .eq("status", "paid")
        .gte("created_at", thirty_days_ago)
        .limit(5000)
        .execute()
    )
    orders_rows = orders_res.data or []
    platform_fee_cents = sum(
        int(round(float(o.get("platform_fee_usd") or 0) * 100))
        for o in orders_rows
    )
    gmv_cents = sum(
        int(round(float(o.get("amount_paid_usd") or 0) * 100))
        for o in orders_rows
    )

    # 5. Recent stream activity (last 7 days).
    seven_days_ago = (now - timedelta(days=7)).isoformat()
    recent_res = (
        supabase.table("stream_sessions")
        .select("merchant_id, start_at")
        .gte("start_at", seven_days_ago)
        .limit(5000)
        .execute()
    )
    recent_rows = recent_res.data or []
    recent_distinct_merchants = len({r.get("merchant_id") for r in recent_rows if r.get("merchant_id")})

    return {
        "as_of": now.isoformat(),
        "yyyymm": yyyymm,
        "active_streams": {
            "count": len(active_streams),
            "rows": active_streams,
        },
        "this_month_usage": {
            "viewer_hours": round(total_viewer_seconds_this_month / 3600.0, 1),
            "stream_count": total_streams_this_month,
            "merchant_count": len(usage_rows),
        },
        "cap_warnings": cap_warnings,
        "stripe_fees_30d": {
            "platform_fee_usd": round(platform_fee_cents / 100.0, 2),
            "gmv_usd": round(gmv_cents / 100.0, 2),
            "order_count": len(orders_rows),
        },
        "recent_streams_7d": {
            "total_streams": len(recent_rows),
            "distinct_merchants": recent_distinct_merchants,
        },
    }


# ─────────────────────────────────────────────────────────────────────
# Merchants monitoring view — owner-only roll-up of every signup.
# Read-only: three SELECTs + Python aggregation. No writes, no schema
# change, no new tables. Reuses the existing `require_admin` gate.
# ─────────────────────────────────────────────────────────────────────


def _merchant_view_is_discoverable(p: dict) -> bool:
    """Mirror /api/projects/public 3-pass union for a single project row.

    A project is shown on /discover iff visibility='public' AND not deleted
    AND at least one of:
      - review_status='approved' AND status='live' (strict standard pass)
      - verified=true (verified-founding-merchant carve-out)
      - is_live=true (actively broadcasting carve-out)
    """
    if p.get("is_deleted") or p.get("visibility") != "public":
        return False
    if p.get("review_status") == "approved" and p.get("status") == "live":
        return True
    if p.get("verified"):
        return True
    if p.get("is_live"):
        return True
    return False


def _merchant_view_primary_sort_key(p: dict):
    """Order key for picking the merchant's most "primary" project row.

    Lower tuple sorts first. Verified first, then status='live', then
    public visibility, then oldest created_at. So the operator sees the
    canonical / verified storefront ahead of seed-residue rows.
    """
    return (
        0 if p.get("verified") else 1,
        0 if p.get("status") == "live" else 1,
        0 if p.get("visibility") == "public" else 1,
        p.get("created_at") or "",
    )


@router.get("/merchants")
async def list_all_merchants(_admin=Depends(require_admin)):
    """Owner-only monitoring view: every merchant + their roll-up state.

    Three-query read-only roll-up. A naive `merchants ⨝ projects` join
    inflates the result (4 merchants × ~18 attached project rows in prod
    today — one merchant has 14+ pre-Phase-0B seed-residue project rows
    from earlier auto-create churn). Aggregating in Python keeps the
    response one-row-per-merchant.

    Response shape (per merchant):
      merchant_id              (uuid)
      business_name            (string, the user's chosen shop name)
      owner_privy_id           (Privy DID — opaque to operators)
      owner_email              (string | null — null when users.email
                                is NULL or when no users row exists)
      signup_date              (merchants.created_at, ISO 8601)
      stripe_connect_status    ('not_connected' | 'connected' | 'verified')
      subscription_tier        ('founding' | 'standard' | null)
      subscription_status      ('active' | 'trialing' | 'inactive' | ...)
      founding_merchant        (bool)
      project_count            (count of merchant's not-deleted projects
                                — surfaces seed-residue at a glance)
      primary_project          ({id, slug, status, visibility, verified,
                                is_live} | null when zero projects)
      discoverable             (bool — true iff at least one of the
                                merchant's projects passes the same
                                3-pass union /api/projects/public uses)
    """
    supabase = get_client()

    merchants = (
        supabase.table("merchants")
        .select(
            "id, owner_privy_id, business_name, stripe_connect_status, "
            "subscription_tier, subscription_status, founding_merchant, "
            "created_at"
        )
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    if not merchants:
        return {"merchants": []}

    privy_ids = [m["owner_privy_id"] for m in merchants if m.get("owner_privy_id")]

    # Users — only the privy_ids we already have from merchants. Email
    # may be NULL on a row, or the row may not exist at all (the
    # /api/auth/sync write that populates users.email runs on every
    # Privy session, but very-first-signup edge cases can leave it
    # absent). Both paths collapse to `owner_email = None`.
    email_by_privy_id: dict[str, str | None] = {}
    if privy_ids:
        try:
            users = (
                supabase.table("users")
                .select("privy_id, email")
                .in_("privy_id", privy_ids)
                .execute()
                .data
                or []
            )
            email_by_privy_id = {
                u["privy_id"]: u.get("email") for u in users if u.get("privy_id")
            }
        except Exception as exc:
            print(f"[admin/merchants] users lookup failed: {exc!r}")

    # Projects — every non-deleted project for the privy_ids we collected.
    # Filter is_deleted=false at the DB so we don't ship residue we're not
    # going to count. visibility / status / review_status / verified /
    # is_live all returned so the aggregation can compute discoverable +
    # primary_project deterministically.
    by_privy_id: dict[str, list[dict]] = {}
    if privy_ids:
        try:
            projects = (
                supabase.table("projects")
                .select(
                    "id, slug, privy_id, status, review_status, visibility, "
                    "is_live, verified, is_deleted, created_at"
                )
                .in_("privy_id", privy_ids)
                .eq("is_deleted", False)
                .order("created_at", desc=True)
                .execute()
                .data
                or []
            )
            for p in projects:
                pid = p.get("privy_id")
                if pid:
                    by_privy_id.setdefault(pid, []).append(p)
        except Exception as exc:
            print(f"[admin/merchants] projects lookup failed: {exc!r}")

    out: list[dict] = []
    for m in merchants:
        pid = m.get("owner_privy_id") or ""
        rows = by_privy_id.get(pid, [])
        primary = sorted(rows, key=_merchant_view_primary_sort_key)[0] if rows else None
        out.append(
            {
                "merchant_id": m.get("id"),
                "business_name": m.get("business_name"),
                "owner_privy_id": pid,
                "owner_email": email_by_privy_id.get(pid),
                "signup_date": m.get("created_at"),
                "stripe_connect_status": m.get("stripe_connect_status"),
                "subscription_tier": m.get("subscription_tier"),
                "subscription_status": m.get("subscription_status"),
                "founding_merchant": m.get("founding_merchant"),
                "project_count": len(rows),
                "primary_project": (
                    {
                        "id": primary.get("id"),
                        "slug": primary.get("slug"),
                        "status": primary.get("status"),
                        "visibility": primary.get("visibility"),
                        "verified": primary.get("verified"),
                        "is_live": primary.get("is_live"),
                    }
                    if primary
                    else None
                ),
                "discoverable": any(
                    _merchant_view_is_discoverable(p) for p in rows
                ),
            }
        )

    return {"merchants": out}
