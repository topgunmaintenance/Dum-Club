from fastapi import APIRouter, Depends, HTTPException
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
