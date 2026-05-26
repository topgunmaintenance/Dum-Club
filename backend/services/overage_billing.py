"""
Phase 3b — livestream viewer-hour overage billing.

Two-layer design (mirrors services/commission.py + services/merchant_limits.py):

  * compute_overage_for_period()
        Pure calculator. Reads merchant_monthly_usage.viewer_seconds
        for the period, resolves the merchant's plan limits, computes
        overage_owed, computes sales_fee_earned for the same period,
        applies the CLAUDE.md §3 no-double-bill rule:
            net_overage = max(0, overage_owed - sales_fee_earned)
        No writes. No Stripe. No mutations.

  * invoice_overage_for_period()
        Wraps the calculator with the idempotency table + the Stripe
        InvoiceItem call. Per-call idempotency comes from the UNIQUE
        constraint on (merchant_id, yyyymm) — a second invocation for
        the same period returns the prior row instead of double-charging.

CLAUDE.md §3 no-double-bill rule, restated:
    > "At billing-period close, if the merchant's 1% sales fee earnings
    >  already cover their viewer-hour overage, the overage is waived
    >  (or netted against the sales fee)."

That's what the net_overage formula does. The platform either gets paid
via the per-sale 1% (always; via Stripe application_fee_amount on every
PaymentIntent) OR via overage billing (only if needed) — never both.

Cross-DID sales-fee aggregation:
  A canonical account may have multiple Privy DIDs in account_logins,
  and historical orders.seller_user_id was set per-DID at the time of
  the sale. To capture ALL sales fees for the merchant's account,
  compute_sales_fee_earned() expands by account_id -> account_logins
  -> set of privy_dids -> orders.seller_user_id IN (...). Falls back
  to the merchant's owner_privy_id alone if account_id is NULL.

Stripe API call:
  When stripe_customer_id is populated and net_overage_cents > 0, we
  call stripe.InvoiceItem.create() against the platform Stripe account.
  This attaches the overage charge to the merchant's next subscription
  invoice (standard Stripe usage-based-billing pattern). Failures are
  recorded with status='failed' and the error string; retries are an
  operator decision (clear the row, re-invoke).

Logging at every decision point per the user's Phase 3b §9:
  * calculated usage in viewer-hours
  * included allowance
  * overage owed (pre-offset)
  * sales-fee offset
  * final net overage (invoiced amount)
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional


# ─────────────────────────────────────────────────────────────────────
# Exceptions
# ─────────────────────────────────────────────────────────────────────

class OverageBillingError(Exception):
    """Raised when overage billing cannot proceed for a structural
    reason (merchant missing, limits unresolved, malformed yyyymm).
    Distinct from Stripe API failures, which are recorded on the row
    with status='failed' rather than raised."""


# ─────────────────────────────────────────────────────────────────────
# Pure calculator
# ─────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class OverageCalculation:
    merchant_id: str
    yyyymm: str
    hours_used: Decimal
    included_vh: Decimal
    overage_hours: Decimal
    overage_rate: Decimal
    overage_owed_cents: int
    sales_fee_earned_cents: int
    net_overage_cents: int


def compute_overage_for_period(
    merchant_id: str,
    yyyymm: str,
    *,
    supabase: Any,
) -> OverageCalculation:
    """Pure calculation. Returns the OverageCalculation for the period."""
    _validate_yyyymm(yyyymm)

    from services.merchant_limits import (
        resolve_merchant_limits,
        MerchantLimitsUnresolved,
    )

    try:
        limits = resolve_merchant_limits(merchant_id, supabase=supabase)
    except MerchantLimitsUnresolved as exc:
        raise OverageBillingError(
            f"cannot bill overage: merchant_limits unresolved: {exc.reason}"
        ) from exc

    viewer_seconds = _read_viewer_seconds(merchant_id, yyyymm, supabase=supabase)
    hours_used = Decimal(viewer_seconds) / Decimal(3600)
    included_vh = limits.max_monthly_viewer_hours
    overage_rate = limits.overage_rate

    overage_hours = max(Decimal(0), hours_used - included_vh)
    # cents = hours × rate_per_hour × 100 cents/dollar
    overage_owed_cents = int(
        (overage_hours * overage_rate * Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )

    sales_fee_earned_cents = compute_sales_fee_earned(
        merchant_id, yyyymm, supabase=supabase,
    )
    net_overage_cents = max(0, overage_owed_cents - sales_fee_earned_cents)

    print(
        f"[overage] calc merchant={merchant_id} yyyymm={yyyymm} "
        f"hours_used={hours_used} included={included_vh} "
        f"overage_hours={overage_hours} overage_rate={overage_rate} "
        f"overage_owed_cents={overage_owed_cents} "
        f"sales_fee_earned_cents={sales_fee_earned_cents} "
        f"net_overage_cents={net_overage_cents}"
    )

    return OverageCalculation(
        merchant_id=merchant_id,
        yyyymm=yyyymm,
        hours_used=hours_used,
        included_vh=included_vh,
        overage_hours=overage_hours,
        overage_rate=overage_rate,
        overage_owed_cents=overage_owed_cents,
        sales_fee_earned_cents=sales_fee_earned_cents,
        net_overage_cents=net_overage_cents,
    )


def compute_sales_fee_earned(
    merchant_id: str,
    yyyymm: str,
    *,
    supabase: Any,
) -> int:
    """Sum orders.application_fee_amount_cents for paid orders in the
    period across every Privy DID linked to the merchant's canonical
    account. Falls back to the merchant's own owner_privy_id when the
    account_id linkage isn't populated (pre-canonical merchants).
    """
    m_res = (
        supabase.table("merchants")
        .select("owner_privy_id, account_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not m_res.data:
        return 0
    merchant = m_res.data[0]

    privy_dids = set()
    account_id = merchant.get("account_id")
    if account_id:
        logins_res = (
            supabase.table("account_logins")
            .select("privy_did")
            .eq("account_id", account_id)
            .execute()
        )
        privy_dids = {r["privy_did"] for r in (logins_res.data or [])}
    if merchant.get("owner_privy_id"):
        privy_dids.add(merchant["owner_privy_id"])

    if not privy_dids:
        return 0

    start_dt, end_dt = _yyyymm_bounds(yyyymm)

    orders_res = (
        supabase.table("orders")
        .select("application_fee_amount_cents")
        .in_("seller_user_id", list(privy_dids))
        .eq("status", "paid")
        .gte("created_at", start_dt.isoformat())
        .lt("created_at", end_dt.isoformat())
        .execute()
    )
    total_cents = 0
    for row in (orders_res.data or []):
        v = row.get("application_fee_amount_cents")
        if v is not None:
            total_cents += int(v)
    return total_cents


# ─────────────────────────────────────────────────────────────────────
# Invoice driver
# ─────────────────────────────────────────────────────────────────────

def invoice_overage_for_period(
    merchant_id: str,
    yyyymm: str,
    *,
    supabase: Any,
) -> dict:
    """Compute + persist + (if applicable) create Stripe InvoiceItem.

    Idempotent on (merchant_id, yyyymm): a second invocation returns
    the prior row with ``repeated=True`` and does NOT recompute or
    re-invoice. To force a recompute, delete the row first (operator
    decision).

    Returns:
        {
          "repeated": bool,
          "calculation": OverageCalculation,
          "row": <merchant_overage_invoices row>,
        }
    """
    existing = (
        supabase.table("merchant_overage_invoices")
        .select("*")
        .eq("merchant_id", merchant_id)
        .eq("yyyymm", yyyymm)
        .limit(1)
        .execute()
    )
    if existing.data:
        row = existing.data[0]
        print(
            f"[overage] idempotency hit merchant={merchant_id} yyyymm={yyyymm} "
            f"status={row.get('status')} net_overage_cents={row.get('net_overage_cents')}"
        )
        return {"repeated": True, "row": row}

    calc = compute_overage_for_period(merchant_id, yyyymm, supabase=supabase)

    # Classify outcome
    stripe_invoice_item_id: Optional[str] = None
    error: Optional[str] = None
    if calc.overage_owed_cents == 0:
        status = "skipped_no_overage"
    elif calc.net_overage_cents == 0:
        status = "skipped_offset_by_sales_fee"
    else:
        cust_id = _read_stripe_customer_id(merchant_id, supabase=supabase)
        if not cust_id:
            status = "skipped_no_customer"
            print(
                f"[overage] skip: merchant={merchant_id} has no stripe_customer_id; "
                f"recording obligation of {calc.net_overage_cents} cents for manual invoice"
            )
        else:
            try:
                stripe_invoice_item_id = _create_stripe_invoice_item(
                    customer_id=cust_id,
                    amount_cents=calc.net_overage_cents,
                    yyyymm=yyyymm,
                )
                status = "invoiced"
                print(
                    f"[overage] INVOICED merchant={merchant_id} yyyymm={yyyymm} "
                    f"amount_cents={calc.net_overage_cents} item={stripe_invoice_item_id}"
                )
            except Exception as exc:  # noqa: BLE001
                status = "failed"
                error = repr(exc)
                print(
                    f"[overage] FAILED merchant={merchant_id} yyyymm={yyyymm} "
                    f"amount_cents={calc.net_overage_cents} error={error}"
                )

    row_payload = {
        "merchant_id": merchant_id,
        "yyyymm": yyyymm,
        "hours_used": str(calc.hours_used),
        "included_vh": str(calc.included_vh),
        "overage_hours": str(calc.overage_hours),
        "overage_rate": str(calc.overage_rate),
        "overage_owed_cents": calc.overage_owed_cents,
        "sales_fee_earned_cents": calc.sales_fee_earned_cents,
        "net_overage_cents": calc.net_overage_cents,
        "stripe_invoice_item_id": stripe_invoice_item_id,
        "status": status,
        "error": error,
        "invoiced_at": (
            datetime.now(timezone.utc).isoformat()
            if status == "invoiced" else None
        ),
    }
    insert_res = (
        supabase.table("merchant_overage_invoices").insert(row_payload).execute()
    )
    new_row = insert_res.data[0] if insert_res.data else row_payload
    return {"repeated": False, "calculation": calc, "row": new_row}


# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

def _validate_yyyymm(yyyymm: str) -> None:
    if not yyyymm or len(yyyymm) != 7 or yyyymm[4] != "-":
        raise OverageBillingError(f"invalid yyyymm: {yyyymm!r}")
    try:
        int(yyyymm[:4])
        m = int(yyyymm[5:7])
        if not 1 <= m <= 12:
            raise ValueError()
    except ValueError:
        raise OverageBillingError(f"invalid yyyymm: {yyyymm!r}")


def _yyyymm_bounds(yyyymm: str) -> tuple[datetime, datetime]:
    """Return (period_start_utc, period_end_utc_exclusive)."""
    year, month = int(yyyymm[:4]), int(yyyymm[5:7])
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return start, end


def _read_viewer_seconds(merchant_id, yyyymm, *, supabase) -> int:
    res = (
        supabase.table("merchant_monthly_usage")
        .select("viewer_seconds")
        .eq("merchant_id", merchant_id)
        .eq("yyyymm", yyyymm)
        .limit(1)
        .execute()
    )
    if not res.data:
        return 0
    return int(res.data[0].get("viewer_seconds") or 0)


def _read_stripe_customer_id(merchant_id, *, supabase) -> Optional[str]:
    res = (
        supabase.table("merchants")
        .select("stripe_customer_id")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0].get("stripe_customer_id")


def _create_stripe_invoice_item(
    *,
    customer_id: str,
    amount_cents: int,
    yyyymm: str,
) -> str:
    """Create a Stripe InvoiceItem on the platform account for the
    merchant's customer record. Attached to the next subscription
    invoice automatically. Raises on Stripe failure (caller catches).
    """
    secret = os.getenv("STRIPE_SECRET_KEY")
    if not secret:
        raise RuntimeError(
            "STRIPE_SECRET_KEY not configured; cannot create InvoiceItem"
        )
    import stripe  # local import: only loaded if we actually invoice
    stripe.api_key = secret
    item = stripe.InvoiceItem.create(
        customer=customer_id,
        amount=int(amount_cents),
        currency="usd",
        description=f"DUM Club livestream viewer-hour overage {yyyymm}",
        metadata={
            "kind": "livestream_overage",
            "yyyymm": yyyymm,
        },
    )
    return item.id
