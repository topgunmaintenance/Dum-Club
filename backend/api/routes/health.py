"""
System Health — read-only diagnostic endpoints for admin monitoring.
No DB writes. No secrets exposed.
"""
import os
from datetime import datetime, timezone
from typing import Optional

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

def _stripe_secret_mode_label(key: str) -> str:
    """Mirror of merchant._stripe_secret_mode without importing the route module."""
    if not key:
        return "empty"
    if key.startswith("sk_test_"):
        return "test"
    if key.startswith("sk_live_"):
        return "live"
    return "unknown"


def _stripe_client_id_fp(cid: str) -> str:
    """Non-sensitive fingerprint for STRIPE_CONNECT_CLIENT_ID (ca_ values are public)."""
    if not cid:
        return "empty"
    if not cid.startswith("ca_"):
        return f"malformed(prefix={cid[:3]!r}, len={len(cid)})"
    if len(cid) < 14:
        return f"short(len={len(cid)})"
    return f"{cid[:7]}...{cid[-6:]}(len={len(cid)})"


@router.get("/checkout")
async def health_checkout(_admin=Depends(require_admin)):
    checked_at = _now_iso()
    stripe_secret = os.getenv("STRIPE_SECRET_KEY", "").strip()
    stripe_connect_client_id = os.getenv("STRIPE_CONNECT_CLIENT_ID", "").strip()
    stripe_test_mode = os.getenv("STRIPE_TEST_MODE", "").strip().lower() == "true"
    environment = os.getenv("ENVIRONMENT", "production").strip().lower()
    stripe_configured = bool(stripe_secret)
    webhook_configured = bool(os.getenv("STRIPE_WEBHOOK_SECRET", "").strip())
    secret_mode = _stripe_secret_mode_label(stripe_secret)
    client_id_fp = _stripe_client_id_fp(stripe_connect_client_id)

    issues = []
    if not stripe_configured:
        issues.append("STRIPE_SECRET_KEY not set")
    if not webhook_configured:
        issues.append("STRIPE_WEBHOOK_SECRET not set")
    if not stripe_connect_client_id:
        issues.append("STRIPE_CONNECT_CLIENT_ID not set")
    elif not stripe_connect_client_id.startswith("ca_"):
        issues.append("STRIPE_CONNECT_CLIENT_ID malformed (must start with ca_)")
    if stripe_configured and secret_mode == "unknown":
        issues.append("STRIPE_SECRET_KEY does not match sk_test_*/sk_live_*")
    if environment == "production" and secret_mode == "test":
        issues.append("Production env has sk_test_* secret key — live payments will fail")
    if stripe_test_mode and secret_mode == "live":
        issues.append("STRIPE_TEST_MODE=true with sk_live_* key — bypass is disabled in code, but env should be cleaned up")

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
        stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
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
            "stripe_secret_mode": secret_mode,
            "stripe_connect_client_id_fp": client_id_fp,
            "stripe_test_mode_env": stripe_test_mode,
            "environment": environment,
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


# ── /api/health/ready — readiness probe (deeper than liveness) ──
# Liveness (/api/health) answers "is the process up?". Readiness answers
# "can it serve traffic?" by touching the database. Use this for deeper
# uptime checks; keep the 1-minute uptime monitor on /api/health so a
# transient DB blip doesn't page on every poll.

@router.get("/ready")
async def health_ready():
    db_ok = False
    detail = None
    try:
        sb = get_client()
        # Cheapest possible round-trip: head count on a tiny, always-present
        # table. Confirms the PostgREST + DB path is reachable.
        sb.table("users").select("privy_id", count="exact", head=True).limit(1).execute()
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        detail = str(exc)

    return {
        "ok": db_ok,
        "status": "ready" if db_ok else "not_ready",
        "checked_at": _now_iso(),
        "db": "ok" if db_ok else "error",
        "supabase": "ok" if db_ok else "error",
        **({"error": detail} if detail else {}),
    }


# ── /api/health/metrics — admin-only operational snapshot ──
# Spot-check numbers for the operator (Julian), not public. Gated by
# require_admin. All counts are head=True (no row payloads). failed
# webhook count is guarded: the webhook_events table arrives in the
# Stripe-hardening PR, so this returns null until that ships rather
# than 500-ing.

def _count(sb, table: str, build=None) -> Optional[int]:
    try:
        q = sb.table(table).select("*", count="exact", head=True)
        if build:
            q = build(q)
        res = q.execute()
        return res.count
    except Exception:
        return None


@router.get("/metrics")
async def health_metrics(_admin=Depends(require_admin)):
    from datetime import timedelta

    sb = get_client()
    now = datetime.now(timezone.utc)
    iso_24h = (now - timedelta(hours=24)).isoformat()
    iso_7d = (now - timedelta(days=7)).isoformat()
    iso_30d = (now - timedelta(days=30)).isoformat()

    return {
        "ok": True,
        "checked_at": _now_iso(),
        "merchants": {
            "total": _count(sb, "merchants"),
            "connected": _count(
                sb, "merchants", lambda q: q.eq("stripe_connect_status", "connected")
            ),
            "new_7d": _count(sb, "merchants", lambda q: q.gte("created_at", iso_7d)),
            "new_30d": _count(sb, "merchants", lambda q: q.gte("created_at", iso_30d)),
        },
        "orders_24h": _count(sb, "orders", lambda q: q.gte("created_at", iso_24h)),
        # Guarded: webhook_events ships in the Stripe-hardening PR. Until
        # then this is null, not an error.
        "failed_webhooks_24h": _count(
            sb,
            "webhook_events",
            lambda q: q.eq("processing_status", "failed").gte("received_at", iso_24h),
        ),
        # p50/p95/p99 request latency is a follow-up: it needs an in-process
        # timing ring buffer fed by middleware. Tracked in docs/OBSERVABILITY.md.
        "latency_ms": None,
    }


# ── /api/health/orders-audit ──
# Read-only per-merchant order distribution. Surfaces the
# pending_payment vs paid breakdown, age of the oldest stuck order,
# and how many rows carry Stripe IDs (traceable) vs none (likely
# test rows from pre-launch). NO mutations — recovery is a separate,
# deliberate operator action (POST /api/orders/recover-pending,
# which already exists). The point of THIS endpoint is to see what's
# actually in the table before deciding whether to recover.
#
# Accepts either a privy_id or a UUID owner_id. Resolves to the
# merchant's projects, then aggregates their orders.

@router.get("/orders-audit")
async def health_orders_audit(
    owner_id: str,
    _admin=Depends(require_admin),
):
    from datetime import timedelta

    sb = get_client()
    now = datetime.now(timezone.utc)

    # 1. Resolve owner_id (privy_id or wallet UUID) -> project_ids.
    try:
        proj_q = sb.table("projects").select("id, slug, title, name")
        # Same resolution shape used by /api/projects/?owner_id=.
        # If owner_id matches owner_id (UUID), pick those; else fall
        # back to privy_id column.
        from api.routes.projects import _UUID_RE  # type: ignore
        if _UUID_RE.match(owner_id or ""):
            proj_q = proj_q.eq("owner_id", owner_id)
        else:
            proj_q = proj_q.eq("privy_id", owner_id)
        proj_res = proj_q.eq("is_deleted", False).execute()
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"project lookup failed: {exc!r}",
            "checked_at": _now_iso(),
        }

    projects = proj_res.data or []
    project_ids = [p["id"] for p in projects]

    if not project_ids:
        return {
            "ok": True,
            "owner_id": owner_id,
            "projects": [],
            "orders": {
                "total": 0,
                "by_status": {},
                "stuck_pending_payment": {
                    "count": 0,
                    "oldest_age_hours": None,
                    "with_stripe_session_id": 0,
                    "with_stripe_payment_intent_id": 0,
                    "with_no_stripe_ids": 0,
                },
            },
            "checked_at": _now_iso(),
        }

    # 2. Fetch all orders for those projects. Cap at 500 — Topgun has
    # 17; even a heavy merchant won't blow past 500 in a single audit.
    try:
        orders_res = (
            sb.table("orders")
            .select(
                "id, status, stripe_session_id, stripe_payment_intent_id,"
                " amount_paid_usd, created_at, project_id"
            )
            .in_("project_id", project_ids)
            .order("created_at", desc=True)
            .limit(500)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": f"orders lookup failed: {exc!r}",
            "checked_at": _now_iso(),
        }

    orders = orders_res.data or []

    # 3. Aggregate by status + drill into pending_payment specifics.
    by_status: dict[str, int] = {}
    stuck_count = 0
    stuck_oldest_age_hours: float | None = None
    stuck_with_session = 0
    stuck_with_pi = 0
    stuck_with_no_ids = 0

    for o in orders:
        s = (o.get("status") or "unknown").strip() or "unknown"
        by_status[s] = by_status.get(s, 0) + 1
        if s == "pending_payment":
            stuck_count += 1
            has_session = bool((o.get("stripe_session_id") or "").strip())
            has_pi = bool((o.get("stripe_payment_intent_id") or "").strip())
            if has_session:
                stuck_with_session += 1
            if has_pi:
                stuck_with_pi += 1
            if not has_session and not has_pi:
                stuck_with_no_ids += 1
            # Age of oldest pending_payment
            created = o.get("created_at")
            if created:
                try:
                    # Supabase returns ISO with timezone; parse defensively.
                    ts = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    age_h = (now - ts).total_seconds() / 3600.0
                    if stuck_oldest_age_hours is None or age_h > stuck_oldest_age_hours:
                        stuck_oldest_age_hours = age_h
                except Exception:
                    pass

    return {
        "ok": True,
        "owner_id": owner_id,
        "projects": [
            {"id": p["id"], "slug": p.get("slug"), "name": p.get("title") or p.get("name")}
            for p in projects
        ],
        "orders": {
            "total": len(orders),
            "by_status": by_status,
            "stuck_pending_payment": {
                "count": stuck_count,
                "oldest_age_hours": (
                    round(stuck_oldest_age_hours, 1)
                    if stuck_oldest_age_hours is not None
                    else None
                ),
                "with_stripe_session_id": stuck_with_session,
                "with_stripe_payment_intent_id": stuck_with_pi,
                "with_no_stripe_ids": stuck_with_no_ids,
            },
        },
        "checked_at": _now_iso(),
        # Interpretation hints for the operator:
        "notes": [
            "with_no_stripe_ids likely means test/dev rows from pre-launch.",
            "with_stripe_session_id but no PI likely means abandoned Checkout sessions.",
            "with_stripe_payment_intent_id but status=pending_payment may indicate a missed webhook — run POST /api/orders/recover-pending after reviewing.",
        ],
    }
