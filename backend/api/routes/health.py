"""
System Health — read-only diagnostic endpoints for admin monitoring.
No DB writes. No secrets exposed.
"""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from db.supabase import get_client
from auth.privy import require_admin

router = APIRouter()

_APP_VERSION = "0.2.0"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe(fn, fallback=None):
    """Run fn, return result or fallback on any error."""
    try:
        return fn()
    except Exception:
        return fallback


# ── /api/health — public liveness probe ──────────────────────

@router.get("")
async def health_root():
    return {
        "ok": True,
        "status": "healthy",
        "system": "backend",
        "message": "DUM Club API is running",
        "checked_at": _now_iso(),
        "details": {
            "version": _APP_VERSION,
            "commit": os.getenv("RAILWAY_GIT_COMMIT_SHA", os.getenv("GIT_COMMIT_SHA", "unknown")),
            "environment": os.getenv("RAILWAY_ENVIRONMENT", os.getenv("ENVIRONMENT", "unknown")),
        },
    }


# ── /api/health/deployment — commit alignment ────────────────

@router.get("/deployment")
async def health_deployment(
    _admin=Depends(require_admin),
    fe_commit: str = Query("", description="Frontend commit hash passed from the browser"),
):
    backend_commit = os.getenv("RAILWAY_GIT_COMMIT_SHA", os.getenv("GIT_COMMIT_SHA", ""))
    # Frontend commit: prefer query param from the browser, fall back to env var
    frontend_commit = fe_commit.strip() or os.getenv("FRONTEND_COMMIT_SHA", "")

    if not backend_commit and not frontend_commit:
        return {
            "ok": True,
            "status": "degraded",
            "system": "deployment",
            "message": "Commit hashes not available. Set RAILWAY_GIT_COMMIT_SHA (Railway auto-sets this) and FRONTEND_COMMIT_SHA env vars for alignment checking.",
            "checked_at": _now_iso(),
            "details": {
                "backend_commit": backend_commit or "not set",
                "frontend_commit": frontend_commit or "not set",
                "aligned": None,
            },
        }

    if not backend_commit or not frontend_commit:
        missing = "backend" if not backend_commit else "frontend"
        return {
            "ok": True,
            "status": "degraded",
            "system": "deployment",
            "message": f"{missing} commit hash not available. Partial alignment check only.",
            "checked_at": _now_iso(),
            "details": {
                "backend_commit": backend_commit or "not set",
                "frontend_commit": frontend_commit or "not set",
                "aligned": None,
            },
        }

    aligned = backend_commit.strip()[:12] == frontend_commit.strip()[:12]
    return {
        "ok": aligned,
        "status": "healthy" if aligned else "degraded",
        "system": "deployment",
        "message": "Frontend and backend commits aligned" if aligned else "Commit mismatch between frontend and backend",
        "checked_at": _now_iso(),
        "details": {
            "backend_commit": backend_commit[:12],
            "frontend_commit": frontend_commit[:12],
            "aligned": aligned,
        },
    }


# ── /api/health/database — Supabase connectivity ─────────────

@router.get("/database")
async def health_database(_admin=Depends(require_admin)):
    checked_at = _now_iso()
    try:
        supabase = get_client()
        # Simple read-only query — count projects
        res = supabase.table("projects").select("id", count="exact").limit(1).execute()
        project_count = res.count if hasattr(res, "count") and res.count is not None else len(res.data or [])

        return {
            "ok": True,
            "status": "healthy",
            "system": "database",
            "message": "Supabase connection healthy",
            "checked_at": checked_at,
            "details": {
                "projects_exist": project_count > 0,
            },
        }
    except Exception as e:
        return {
            "ok": False,
            "status": "broken",
            "system": "database",
            "message": f"Database connection failed: {type(e).__name__}",
            "checked_at": checked_at,
            "details": {},
        }


# ── /api/health/offers — offers system ────────────────────────

@router.get("/offers")
async def health_offers(_admin=Depends(require_admin)):
    checked_at = _now_iso()
    try:
        supabase = get_client()
        # Check offers table is readable and has expected columns
        res = (
            supabase.table("offers")
            .select("id, project_id, title, price_usd, is_active, quantity_sold, quantity_available, unlimited_inventory")
            .limit(1)
            .execute()
        )

        active_res = supabase.table("offers").select("id", count="exact").eq("is_active", True).limit(1).execute()
        active_count = active_res.count if hasattr(active_res, "count") and active_res.count is not None else len(active_res.data or [])

        return {
            "ok": True,
            "status": "healthy",
            "system": "offers",
            "message": "Offers table accessible with expected columns",
            "checked_at": checked_at,
            "details": {
                "table_readable": True,
                "active_offers": active_count,
                "columns_verified": ["id", "project_id", "title", "price_usd", "is_active", "quantity_sold", "quantity_available", "unlimited_inventory"],
            },
        }
    except Exception as e:
        return {
            "ok": False,
            "status": "broken",
            "system": "offers",
            "message": f"Offers system check failed: {type(e).__name__}: {e}",
            "checked_at": checked_at,
            "details": {"table_readable": False},
        }


# ── /api/health/checkout — Stripe + orders ────────────────────

@router.get("/checkout")
async def health_checkout(_admin=Depends(require_admin)):
    checked_at = _now_iso()
    stripe_configured = bool(os.getenv("STRIPE_SECRET_KEY", "").strip())
    webhook_configured = bool(os.getenv("STRIPE_WEBHOOK_SECRET", "").strip())

    issues = []
    if not stripe_configured:
        issues.append("STRIPE_SECRET_KEY not set")
    if not webhook_configured:
        issues.append("STRIPE_WEBHOOK_SECRET not set")

    resend_configured = bool(os.getenv("RESEND_API_KEY", "").strip())
    if not resend_configured:
        issues.append("RESEND_API_KEY not set — order emails will not send")

    # Check orders table
    orders_ok = False
    last_paid_at = None
    pending_count = 0
    total_orders = 0
    try:
        supabase = get_client()
        supabase.table("orders").select("id").limit(1).execute()
        orders_ok = True

        # Last successful paid order
        paid_res = (
            supabase.table("orders")
            .select("updated_at")
            .eq("status", "paid")
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
        if paid_res.data:
            last_paid_at = paid_res.data[0].get("updated_at")

        # Count stuck pending_payment orders
        pending_res = (
            supabase.table("orders")
            .select("id", count="exact")
            .eq("status", "pending_payment")
            .execute()
        )
        pending_count = pending_res.count if hasattr(pending_res, "count") and pending_res.count is not None else len(pending_res.data or [])

        all_res = (
            supabase.table("orders")
            .select("id", count="exact")
            .execute()
        )
        total_orders = all_res.count if hasattr(all_res, "count") and all_res.count is not None else len(all_res.data or [])
    except Exception as e:
        issues.append(f"Orders table error: {type(e).__name__}")

    if pending_count > 0:
        issues.append(f"{pending_count} orders stuck in pending_payment (webhook may not be delivering)")

    # Check Stripe webhook endpoints if possible
    webhook_endpoints = []
    try:
        import stripe
        stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
        endpoints = stripe.WebhookEndpoint.list(limit=10)
        for ep in endpoints.get("data", []):
            webhook_endpoints.append({
                "url": ep.get("url", ""),
                "status": ep.get("status", ""),
                "enabled_events": ep.get("enabled_events", []),
            })
    except Exception:
        pass  # Stripe SDK may not be available or key may be invalid

    if issues:
        status = "broken" if not stripe_configured else "degraded"
    else:
        status = "healthy"

    return {
        "ok": len(issues) == 0,
        "status": status,
        "system": "checkout",
        "message": "; ".join(issues) if issues else "Stripe configured and orders table accessible",
        "checked_at": checked_at,
        "details": {
            "stripe_key_present": stripe_configured,
            "webhook_secret_present": webhook_configured,
            "resend_key_present": resend_configured,
            "orders_table_readable": orders_ok,
            "last_paid_order_at": last_paid_at,
            "total_orders": total_orders,
            "pending_payment_orders": pending_count,
            "stripe_webhook_endpoints": webhook_endpoints,
        },
    }


# ── /api/health/trading — token market ────────────────────────

@router.get("/trading")
async def health_trading(_admin=Depends(require_admin)):
    checked_at = _now_iso()
    tables_ok = {}
    last_trade_at = None

    try:
        supabase = get_client()

        for table in ("project_trades", "project_market_state", "project_balances"):
            try:
                supabase.table(table).select("*").limit(1).execute()
                tables_ok[table] = True
            except Exception:
                tables_ok[table] = False

        # Last trade timestamp
        try:
            trade_res = (
                supabase.table("project_trades")
                .select("created_at")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if trade_res.data:
                last_trade_at = trade_res.data[0].get("created_at")
        except Exception:
            pass

        all_ok = all(tables_ok.values())
        return {
            "ok": all_ok,
            "status": "healthy" if all_ok else "degraded",
            "system": "trading",
            "message": "Trading tables accessible" if all_ok else f"Some tables inaccessible: {[k for k, v in tables_ok.items() if not v]}",
            "checked_at": checked_at,
            "details": {
                "tables": tables_ok,
                "last_trade_at": last_trade_at,
            },
        }
    except Exception as e:
        return {
            "ok": False,
            "status": "broken",
            "system": "trading",
            "message": f"Trading system check failed: {type(e).__name__}",
            "checked_at": checked_at,
            "details": {"tables": tables_ok},
        }
