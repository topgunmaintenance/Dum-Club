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


class DeleteMerchantBody(BaseModel):
    # Type-the-name confirmation: must match the merchant's business_name
    # (case-insensitive) or the delete is refused. A mis-click can never
    # remove a real merchant.
    confirm_name: str


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

@router.post("/merchants/{merchant_id}/start-trial")
async def start_merchant_trial(merchant_id: str, _admin=Depends(require_admin)):
    """Start the founding trial (TRIAL_DAYS, default 30) for an EXISTING
    merchant (trial-starter, 2026-07-06). Signup sends merchants through
    card-upfront Checkout since the checkout-trial PR; this remains the
    deliberate, per-merchant admin backfill and the ONE path that still
    grants a trial without a card on file (create_trial_subscription).
    Guarded: refuses if a subscription already exists."""
    supabase = get_client()
    res = (
        supabase.table("merchants")
        .select("id, owner_privy_id, business_name, founding_merchant, stripe_subscription_id, plan_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    merchant = res.data[0]
    if merchant.get("stripe_subscription_id"):
        raise HTTPException(status_code=409, detail="Merchant already has a subscription")

    email = None
    try:
        u = (
            supabase.table("users")
            .select("email")
            .eq("privy_id", merchant.get("owner_privy_id"))
            .limit(1)
            .execute()
        )
        email = u.data[0].get("email") if u.data else None
    except Exception:
        pass

    from services.subscriptions import create_trial_subscription

    tier = "starter" if merchant.get("founding_merchant") else (merchant.get("plan_id") or "growth")
    trial = create_trial_subscription(
        privy_id=merchant.get("owner_privy_id") or "",
        email=email,
        business_name=merchant.get("business_name"),
        tier=tier,
    )
    if trial.get("error"):
        raise HTTPException(status_code=502, detail=f"Trial provisioning failed: {trial['error']}")

    update = {
        "stripe_customer_id": trial.get("stripe_customer_id"),
        "stripe_subscription_id": trial.get("stripe_subscription_id"),
        "subscription_price_id": trial.get("subscription_price_id"),
        "trial_start_at": trial.get("trial_start_at"),
        "trial_ends_at": trial.get("trial_ends_at"),
        "next_billing_at": trial.get("next_billing_at"),
        "subscription_status": trial.get("subscription_status") or "trialing",
        "grandfathered": False,
    }
    update = {k: v for k, v in update.items() if v is not None}
    # Conditional write (audit finding 7): only claim the merchant row if
    # nobody else did between our read and now. Zero rows updated means a
    # concurrent click won the race — cancel the subscription WE minted so
    # no untracked twin lives on in Stripe. (The idempotency keys in
    # create_trial_subscription make even that cancel rarely necessary.)
    res = (
        supabase.table("merchants")
        .update(update)
        .eq("id", merchant_id)
        .is_("stripe_subscription_id", "null")
        .execute()
    )
    if not res.data:
        try:
            from services.subscriptions import cancel_subscription
            sub_id = trial.get("stripe_subscription_id")
            if sub_id:
                cancel_subscription(sub_id)
                print(f"[admin/start-trial] lost the race for {merchant_id}; cancelled duplicate sub {sub_id}")
        except Exception as exc:
            print(f"[admin/start-trial] duplicate-sub cancel failed (check Stripe): {exc!r}")
        raise HTTPException(status_code=409, detail="Trial was already started by another request")
    return {"status": "success", "merchant_id": merchant_id, **update}


@router.post("/merchants/{merchant_id}/cancel-subscription")
async def admin_cancel_subscription(merchant_id: str, _admin=Depends(require_admin)):
    """Cancel a merchant's Stripe subscription from the admin page
    (admin-toolkit, 2026-07-07) instead of digging through the Stripe
    dashboard. Immediate cancel, same path as the merchant's own
    cancel-trial button. The webhook keeps the row in sync, but we also
    write subscription_status through directly so the admin table
    reflects it on the next refresh without waiting."""
    supabase = get_client()
    res = (
        supabase.table("merchants")
        .select("id, business_name, stripe_subscription_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    sub_id = res.data[0].get("stripe_subscription_id")
    if not sub_id:
        raise HTTPException(status_code=409, detail="Merchant has no subscription to cancel")

    from services.subscriptions import cancel_subscription

    if not cancel_subscription(sub_id):
        raise HTTPException(status_code=502, detail="Stripe cancel failed. Check the Stripe dashboard.")
    try:
        supabase.table("merchants").update(
            {"subscription_status": "cancelled"}
        ).eq("id", merchant_id).execute()
    except Exception as exc:
        print(f"[admin/cancel-subscription] status write-through failed (webhook will sync): {exc!r}")
    return {"status": "cancelled", "merchant_id": merchant_id}


@router.post("/merchants/{merchant_id}/checkout-link")
async def admin_checkout_link(merchant_id: str, _admin=Depends(require_admin)):
    """Mint a fresh card-upfront trial Checkout link for a merchant whose
    trial setup stalled (admin-toolkit, 2026-07-07). Returns the URL for
    the operator to copy and send. Same guard as the merchant-facing
    /api/merchant/trial-checkout: refuses when a subscription exists.
    Deliberately does NOT run the trial-identity gate — the operator is
    making a human decision, same trust posture as start-trial."""
    import os as _os

    supabase = get_client()
    res = (
        supabase.table("merchants")
        .select("id, owner_privy_id, business_name, founding_merchant, plan_id, stripe_subscription_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    merchant = res.data[0]
    if merchant.get("stripe_subscription_id"):
        raise HTTPException(status_code=409, detail="Merchant already has a subscription")

    email = None
    try:
        u = (
            supabase.table("users")
            .select("email")
            .eq("privy_id", merchant.get("owner_privy_id"))
            .limit(1)
            .execute()
        )
        email = u.data[0].get("email") if u.data else None
    except Exception:
        pass

    from services.subscriptions import create_trial_checkout_session

    tier = "starter" if merchant.get("founding_merchant") else (merchant.get("plan_id") or "growth")
    site = _os.getenv("SITE_URL", "https://www.dum.club").rstrip("/")
    trial = create_trial_checkout_session(
        privy_id=merchant.get("owner_privy_id") or "",
        email=email,
        business_name=merchant.get("business_name"),
        tier=tier,
        merchant_id=merchant["id"],
        identity_hash=None,
        success_url=f"{site}/merchant?trial=started",
        cancel_url=f"{site}/merchant?trial=abandoned",
    )
    if trial.get("error"):
        raise HTTPException(status_code=502, detail=f"Checkout link failed: {trial['error']}")
    if trial.get("stripe_customer_id"):
        try:
            supabase.table("merchants").update(
                {"stripe_customer_id": trial["stripe_customer_id"]}
            ).eq("id", merchant_id).execute()
        except Exception as exc:
            print(f"[admin/checkout-link] customer_id save failed (ignored): {exc!r}")
    return {"url": trial.get("checkout_url"), "merchant_id": merchant_id}


@router.delete("/merchants/{merchant_id}")
async def delete_merchant(merchant_id: str, body: DeleteMerchantBody, _admin=Depends(require_admin)):
    """Permanently delete a merchant and everything they own
    (admin-toolkit, 2026-07-07). This is the nuclear option for junk /
    test signups — for real merchants misbehaving, use suspend instead.

    Order of operations (mirrors the FK graph; children of projects
    cascade, but orders and a few claim columns are NO ACTION and must
    be handled first):
      1. type-the-name confirmation check
      2. cancel the Stripe subscription if one exists (best-effort —
         never leave a headless subscription billing someone)
      3. unhook external_businesses.claimed_project_id + auctions.winner_order_id
      4. delete orders for the merchant's projects
      5. delete the projects (cascades offers, streams, replays, analytics, ...)
      6. delete the merchants row (cascades usage / limits / reminder logs)
    The users row and Privy account are kept — the person can sign up
    fresh, which is the whole point."""
    supabase = get_client()
    res = (
        supabase.table("merchants")
        .select("id, business_name, owner_privy_id, stripe_subscription_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    merchant = res.data[0]

    expected = (merchant.get("business_name") or "").strip().lower()
    provided = (body.confirm_name or "").strip().lower()
    if not expected or provided != expected:
        raise HTTPException(
            status_code=400,
            detail="Confirmation name does not match the business name. Nothing was deleted.",
        )

    # 2. Never orphan a live Stripe subscription.
    sub_id = merchant.get("stripe_subscription_id")
    if sub_id:
        from services.subscriptions import cancel_subscription

        if not cancel_subscription(sub_id):
            raise HTTPException(
                status_code=502,
                detail="Could not cancel the Stripe subscription. Delete aborted — nothing was removed.",
            )

    owner = merchant.get("owner_privy_id")
    try:
        projects = (
            supabase.table("projects")
            .select("id")
            .eq("privy_id", owner)
            .execute()
            .data
            or []
        ) if owner else []
        project_ids = [p["id"] for p in projects]

        if project_ids:
            # 3. NO ACTION references that would block the deletes below.
            supabase.table("external_businesses").update(
                {"claimed_project_id": None}
            ).in_("claimed_project_id", project_ids).execute()

            orders = (
                supabase.table("orders")
                .select("id")
                .in_("project_id", project_ids)
                .execute()
                .data
                or []
            )
            order_ids = [o["id"] for o in orders]
            if order_ids:
                supabase.table("auctions").update(
                    {"winner_order_id": None}
                ).in_("winner_order_id", order_ids).execute()
                # 4. The merchant's order history goes with them.
                supabase.table("orders").delete().in_("id", order_ids).execute()

            # 5. Cascades take offers, stream sessions, replays, bookings,
            #    analytics events, service profiles, and the rest.
            supabase.table("projects").delete().in_("id", project_ids).execute()

        # 6. The merchant row itself.
        supabase.table("merchants").delete().eq("id", merchant_id).execute()
    except Exception as exc:
        print(f"[admin/delete-merchant] delete failed for {merchant_id}: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="Delete hit a database error partway. Check the row states before retrying.",
        )

    print(
        f"[admin/delete-merchant] deleted merchant={merchant_id} "
        f"({merchant.get('business_name')!r}), projects={len(project_ids)}, owner kept"
    )
    return {"status": "deleted", "merchant_id": merchant_id, "projects_deleted": len(project_ids)}


@router.get("/merchants/stats")
async def merchants_stats(_admin=Depends(require_admin)):
    """Roll-up numbers for the top of /admin/merchants (admin-toolkit,
    2026-07-07). Internal-only — doctrine forbids these counts on any
    PUBLIC surface, this endpoint is admin-gated like the rest.

    Python-side aggregation, same reasoning as list_all_merchants: row
    counts are founding-ramp scale, correctness beats cleverness."""
    supabase = get_client()

    merchants = (
        supabase.table("merchants")
        .select("id, founding_merchant, subscription_status, stripe_connect_status, stripe_subscription_id")
        .execute()
        .data
        or []
    )
    orders = (
        supabase.table("orders")
        .select("id, amount_paid_usd, status")
        .execute()
        .data
        or []
    )

    paid_statuses = {"paid", "fulfilled"}
    paid_orders = [o for o in orders if (o.get("status") or "") in paid_statuses]
    gmv = sum(float(o.get("amount_paid_usd") or 0) for o in paid_orders)

    by_status: dict[str, int] = {}
    for m in merchants:
        s = m.get("subscription_status") or "none"
        by_status[s] = by_status.get(s, 0) + 1

    return {
        "merchants_total": len(merchants),
        "founding_used": sum(1 for m in merchants if m.get("founding_merchant")),
        "founding_cap": 100,
        "with_subscription": sum(1 for m in merchants if m.get("stripe_subscription_id")),
        "trialing": sum(1 for m in merchants if m.get("subscription_status") == "trialing"),
        "connect_verified": sum(1 for m in merchants if m.get("stripe_connect_status") == "verified"),
        "by_subscription_status": by_status,
        "orders_paid": len(paid_orders),
        "gmv_usd": round(gmv, 2),
    }


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


@router.get("/merchants/{merchant_id}/offers")
async def list_merchant_offers(merchant_id: str, _admin=Depends(require_admin)):
    """Enforcement view: every offer belonging to one merchant's shops,
    with takedown state, so the admin UI can act on a single listing."""
    supabase = get_client()
    m = (
        supabase.table("merchants")
        .select("owner_privy_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not m.data:
        raise HTTPException(status_code=404, detail="Merchant not found")
    privy_id = m.data[0].get("owner_privy_id")
    projects = (
        supabase.table("projects")
        .select("id, title")
        .eq("privy_id", privy_id)
        .eq("is_deleted", False)
        .execute()
        .data
        or []
    )
    if not projects:
        return {"offers": []}
    titles = {p["id"]: p.get("title") for p in projects}
    offers = (
        supabase.table("offers")
        .select("id, project_id, title, price_usd, is_active, admin_removed, admin_removed_reason")
        .in_("project_id", list(titles.keys()))
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )
    for o in offers:
        o["project_title"] = titles.get(o.get("project_id"))
    return {"offers": offers}


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
            "created_at, admin_suspended, admin_suspended_reason, "
            "stripe_customer_id, stripe_subscription_id"
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
                "admin_suspended": bool(m.get("admin_suspended")),
                "admin_suspended_reason": m.get("admin_suspended_reason"),
                # admin-toolkit (2026-07-07): direct Stripe links + the
                # cancel-subscription button need these on the row.
                "stripe_customer_id": m.get("stripe_customer_id"),
                "stripe_subscription_id": m.get("stripe_subscription_id"),
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
