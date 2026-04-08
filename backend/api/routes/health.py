"""
System Health — read-only diagnostic endpoints for admin monitoring.
No DB writes. No secrets exposed.
"""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from db.supabase import get_client
from auth.privy import require_admin
from services.readiness import email_status, solana_status, dum_points_status

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
    except Exception as stripe_err:
        # Non-critical enrichment — the /checkout probe still reports
        # Stripe config state without the webhook endpoint list.
        print(f"[admin] stripe webhook listing failed (non-critical) err={type(stripe_err).__name__}: {stripe_err}")

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
    simulated_live_project_count = 0
    onchain_live_project_count = 0

    try:
        supabase = get_client()

        for table in ("project_trades", "project_market_state", "project_balances"):
            try:
                supabase.table(table).select("*").limit(1).execute()
                tables_ok[table] = True
            except Exception as table_err:
                tables_ok[table] = False
                print(f"[admin] trading table check failed table={table} err={type(table_err).__name__}: {table_err}")

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
        except Exception as trade_err:
            print(f"[admin] last_trade_at query failed err={type(trade_err).__name__}: {trade_err}")

        # Count live projects by token mode (simulated SIM_ vs real on-chain).
        # Best-effort — never fail the health probe if one of the counts errs.
        try:
            live_res = (
                supabase.table("projects")
                .select("token_mint_address")
                .eq("status", "live")
                .eq("is_deleted", False)
                .limit(500)
                .execute()
            )
            for row in (live_res.data or []):
                mint = (row.get("token_mint_address") or "")
                if not mint or mint.startswith("SIM_"):
                    simulated_live_project_count += 1
                else:
                    onchain_live_project_count += 1
        except Exception as mode_err:
            print(f"[admin] live-project mode count failed err={type(mode_err).__name__}: {mode_err}")

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
                # Additive: honest report of what the "trading" subsystem is
                # actually running today. SIM_ projects are DB-only ledger;
                # the trade engine is a synthetic price-impact formula until
                # on-chain minting ships. See backend/services/readiness.py.
                "simulated_live_project_count": simulated_live_project_count,
                "onchain_live_project_count": onchain_live_project_count,
                "trade_engine_mode": "simulated_ledger" if onchain_live_project_count == 0 else "mixed",
            },
        }
    except Exception as e:
        print(f"[admin] trading health check crashed err={type(e).__name__}: {e!r}")
        return {
            "ok": False,
            "status": "broken",
            "system": "trading",
            "message": f"Trading system check failed: {type(e).__name__}",
            "checked_at": checked_at,
            "details": {"tables": tables_ok},
        }


# ── /api/health/email — Resend email subsystem ───────────────

@router.get("/email")
async def health_email(_admin=Depends(require_admin)):
    """
    Email subsystem readiness. Reports whether Resend is configured.
    Does NOT make a real send — config check only.
    """
    checked_at = _now_iso()
    status = email_status()
    ok = bool(status.get("enabled"))
    return {
        "ok": ok,
        "status": "healthy" if ok else "degraded",
        "system": "email",
        "message": "Resend configured" if ok else (status.get("reason") or "Email delivery disabled"),
        "checked_at": checked_at,
        "details": status,
    }


# ── /api/health/solana — on-chain mint/claim readiness ───────

@router.get("/solana")
async def health_solana(_admin=Depends(require_admin)):
    """
    Solana on-chain mint/claim readiness. Reports config + enabled state.
    No private keys in the response — only booleans, the public RPC URL,
    and the public mint address.
    """
    checked_at = _now_iso()
    status = solana_status()
    ok = bool(status.get("mint_enabled"))
    return {
        "ok": ok,
        "status": "healthy" if ok else "degraded",
        "system": "solana",
        "message": "On-chain mint path ready" if ok else (status.get("reason") or "On-chain mint disabled"),
        "checked_at": checked_at,
        "details": status,
    }


# ── /api/health/dum — DUM Points claim readiness ─────────────

@router.get("/dum")
async def health_dum(_admin=Depends(require_admin)):
    """
    DUM Points subsystem readiness — claim mode, cooldowns, swap caps.
    Never overstates on-chain readiness; falls back to db_only when the
    Solana config is incomplete.
    """
    checked_at = _now_iso()
    status = dum_points_status()
    claim_mode = status.get("claim_mode", "db_only")
    onchain_ready = bool(status.get("onchain_claim_ready"))

    if onchain_ready:
        health_status = "healthy"
        message = "DUM Points claim is on-chain ready"
    else:
        health_status = "degraded"
        message = "DUM Points claim is DB-only (on-chain not configured)"

    return {
        "ok": True,  # claims still work in db_only mode — not "broken"
        "status": health_status,
        "system": "dum_points",
        "message": message,
        "checked_at": checked_at,
        "details": status,
    }


# ── /api/health/reliability — compact roll-up ────────────────

@router.get("/reliability")
async def health_reliability(_admin=Depends(require_admin)):
    """
    Single compact roll-up of the subsystems added in the reliability PR.
    Reads the readiness helpers — no DB calls, no RPC calls, no real
    sends. Safe to hit frequently.
    """
    checked_at = _now_iso()
    e = email_status()
    s = solana_status()
    d = dum_points_status()

    any_degraded = (not e.get("enabled")) or (not s.get("mint_enabled")) or (not d.get("onchain_claim_ready"))

    return {
        "ok": True,
        "status": "degraded" if any_degraded else "healthy",
        "system": "reliability",
        "message": "Reliability roll-up",
        "checked_at": checked_at,
        "details": {
            "email": e,
            "solana": s,
            "dum_points": d,
        },
    }
