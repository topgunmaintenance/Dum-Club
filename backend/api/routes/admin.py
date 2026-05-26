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
