"""
Commission rate resolution for sale-time checkout.

Resolution order at sale time:

    1. merchants.commission_rate_override     (migration 050)
       If NOT NULL — including 0.0000 — this wins. 0.0000 means
       "deliberate comp/promo"; the resolver uses `is not None`,
       never truthiness, so a 0.0000 override is preserved instead
       of falling through to the plan default.

    2. plan_limits.commission_rate via merchants.plan_id
       (migration 049 / 051). If the merchant has a plan_id and the
       plan_limits row has a non-NULL commission_rate, use it.
       Migration 054 set every tier to 0.0100 (1% sales fee) after
       migration 053's earlier zeroing; today this returns
       Decimal("0.0100") for any non-overridden merchant on one of
       the five seeded tiers. The lookup still happens so a future
       doctrine change (different tier rate) Just Works.

    3. Raise CommissionRateUnset.
       Fail closed. The caller must refuse the sale-setup rather
       than silently default. This is the doctrine-correct posture:
       the 1% sales fee is encoded as an explicit value in
       plan_limits, never as "absence of a rate". A NULL
       commission_rate column means the rate is unset and the
       sale-setup MUST fail rather than guess.

This module performs ONLY the read + arithmetic to derive a rate. It
does NOT call Stripe, write orders, or read frontend input. The result
is a Decimal so callers can compute integer cents with no float drift.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any


class CommissionRateUnset(Exception):
    """No rate could be resolved for the merchant. Caller MUST refuse
    to create the sale-setup (Stripe Session, etc) rather than fall
    back to a default. Stamps the reason for the audit trail."""

    def __init__(self, seller_user_id: str, reason: str):
        self.seller_user_id = seller_user_id
        self.reason = reason
        super().__init__(
            f"commission rate unresolved for seller={seller_user_id!r}: {reason}"
        )


def resolve_commission_rate(seller_user_id: str, *, supabase: Any) -> Decimal:
    """Return the commission rate to apply to a sale for this seller.

    Args:
        seller_user_id: The seller's Privy DID. Matches
            merchants.owner_privy_id — the same shape every checkout
            call site already uses.
        supabase: Supabase client (sync). Injected so tests can mock.

    Returns:
        Decimal in [0, 0.5]. Caller multiplies by amount_cents and
        rounds to int to derive application_fee_amount_cents.

    Raises:
        CommissionRateUnset: when neither an override nor a plan
            default is set. Treat as a hard refusal; do NOT default.
    """
    merchant_res = (
        supabase.table("merchants")
        .select("id, commission_rate_override, plan_id")
        .eq("owner_privy_id", seller_user_id)
        .eq("active", True)
        .limit(1)
        .execute()
    )
    if not merchant_res.data:
        raise CommissionRateUnset(
            seller_user_id,
            "no active merchants row for owner_privy_id",
        )

    row = merchant_res.data[0]

    # 1. Per-merchant override. Explicit `is not None` so a stored
    #    0.0000 (deliberate comp) is honored instead of silently
    #    falling through to the plan default.
    override = row.get("commission_rate_override")
    if override is not None:
        return Decimal(str(override))

    # 2. Plan default via the bridge column added in migration 051.
    plan_id = row.get("plan_id")
    if not plan_id:
        raise CommissionRateUnset(
            seller_user_id,
            "commission_rate_override is NULL and plan_id is NULL",
        )

    plan_res = (
        supabase.table("plan_limits")
        .select("plan_id, commission_rate")
        .eq("plan_id", plan_id)
        .limit(1)
        .execute()
    )
    if not plan_res.data:
        raise CommissionRateUnset(
            seller_user_id,
            f"plan_limits row missing for plan_id={plan_id!r}",
        )

    plan_rate = plan_res.data[0].get("commission_rate")
    if plan_rate is None:
        raise CommissionRateUnset(
            seller_user_id,
            f"plan_limits.commission_rate is NULL for plan_id={plan_id!r}",
        )

    # 3. Always Decimal back to the caller. Going through str avoids
    #    the float → Decimal binary-precision trap; postgrest may
    #    serialize NUMERIC(5,4) as a JSON number (float) or string
    #    depending on client version, and either round-trips through
    #    str cleanly.
    return Decimal(str(plan_rate))
