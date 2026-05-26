"""
Per-merchant livestream limit resolution for runtime cap enforcement.

Resolution order at gate-time:

    1. merchant_plan_limits override row (migration 048)
       Per-merchant override columns: max_concurrent_viewers,
       max_stream_duration_min, max_streams_per_day,
       max_monthly_viewer_hours. NULL on any column falls through
       to the plan default.

    2. plan_limits row via merchants.plan_id (migration 049)
       Per-tier defaults: included_vh (=max_monthly_viewer_hours
       semantically), max_concurrent (=max_concurrent_viewers
       semantically), max_concurrent_streams, overage_rate,
       hard_block_multiplier.

    3. Raise MerchantLimitsUnresolved.
       Fail closed on any unset cap. Doctrine from migration 049:
       "for caps NULL means resolve per merchant
       (Business/Enterprise), NOT 'unlimited'. Enforcement must
       fail closed on a NULL cap."

The resolver returns a frozen dataclass so callers can't accidentally
mutate the resolved limits between checks. All numeric fields use
Decimal to avoid float drift on viewer-hour math.

This module performs ONLY the read + reconciliation. It does NOT
call AWS, write counters, or query telemetry tables.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional


# Global stream-duration default. Per-merchant override (`merchant_plan_limits
# .max_stream_duration_min`) wins when set. `plan_limits` doesn't carry a
# per-tier duration column — duration is treated as a platform-wide safety
# cap, configurable per-merchant on contract.
DEFAULT_MAX_STREAM_DURATION_MIN = 60


class MerchantLimitsUnresolved(Exception):
    """No live-streaming limits could be resolved for the merchant.

    Caller MUST refuse to start a stream / mint a viewer token rather
    than fall back to a permissive default. Stamps merchant_id + reason
    for the audit trail.

    Doctrine reference: migration 049's seed comment — "Enforcement
    must fail closed on a NULL cap."
    """

    def __init__(self, merchant_id: str, reason: str):
        self.merchant_id = merchant_id
        self.reason = reason
        super().__init__(
            f"merchant limits unresolved for merchant_id={merchant_id!r}: {reason}"
        )


@dataclass(frozen=True)
class MerchantLimits:
    """Resolved livestream caps for one merchant. All values are
    guaranteed non-NULL; a resolver that couldn't fill a field would
    have raised MerchantLimitsUnresolved instead.
    """
    merchant_id: str
    plan_id: str
    max_concurrent_viewers: int
    max_concurrent_streams: int
    max_stream_duration_min: int
    max_monthly_viewer_hours: Decimal
    overage_rate: Decimal
    hard_block_multiplier: Decimal


def resolve_merchant_limits(merchant_id: str, *, supabase: Any) -> MerchantLimits:
    """Return the resolved per-merchant livestream caps.

    Args:
        merchant_id: merchants.id UUID. Same shape as Phase 0 telemetry
            uses (see services/stream_telemetry._resolve_merchant_id).
        supabase: Supabase client. Injected so callers can pass an
            already-acquired client and tests can mock.

    Returns:
        MerchantLimits dataclass with every field populated.

    Raises:
        MerchantLimitsUnresolved when:
          - merchant row missing or inactive
          - merchants.plan_id is NULL
          - plan_limits row missing
          - max_concurrent / max_concurrent_streams / included_vh are
            NULL on the plan AND no override is set in
            merchant_plan_limits. (Business / Enterprise tiers per
            migration 049 doctrine.)
    """
    # 1. Merchant row (must be active).
    merchant_res = (
        supabase.table("merchants")
        .select("id, plan_id, active")
        .eq("id", merchant_id)
        .limit(1)
        .execute()
    )
    if not merchant_res.data:
        raise MerchantLimitsUnresolved(merchant_id, "merchants row not found")

    merchant = merchant_res.data[0]
    if not merchant.get("active"):
        raise MerchantLimitsUnresolved(merchant_id, "merchant is inactive")

    plan_id = merchant.get("plan_id")
    if not plan_id:
        raise MerchantLimitsUnresolved(merchant_id, "merchants.plan_id is NULL")

    # 2. Per-merchant override row (may be absent — that's fine, all
    #    fields fall through to the plan default).
    override_res = (
        supabase.table("merchant_plan_limits")
        .select(
            "max_concurrent_viewers, max_stream_duration_min, "
            "max_streams_per_day, max_monthly_viewer_hours"
        )
        .eq("merchant_id", merchant_id)
        .limit(1)
        .execute()
    )
    override = override_res.data[0] if override_res.data else {}

    # 3. Plan defaults.
    plan_res = (
        supabase.table("plan_limits")
        .select(
            "plan_id, included_vh, max_concurrent, max_concurrent_streams, "
            "overage_rate, hard_block_multiplier"
        )
        .eq("plan_id", plan_id)
        .limit(1)
        .execute()
    )
    if not plan_res.data:
        raise MerchantLimitsUnresolved(
            merchant_id,
            f"plan_limits row missing for plan_id={plan_id!r}",
        )
    plan = plan_res.data[0]

    # 4. Reconcile per field, fail closed on any unset cap.
    max_concurrent_viewers = _coalesce_int(
        override.get("max_concurrent_viewers"),
        plan.get("max_concurrent"),
    )
    if max_concurrent_viewers is None:
        raise MerchantLimitsUnresolved(
            merchant_id,
            f"max_concurrent_viewers unset (plan={plan_id!r} has NULL "
            f"max_concurrent and no merchant_plan_limits override). "
            f"Set merchant_plan_limits.max_concurrent_viewers before "
            f"this merchant can go live.",
        )

    max_concurrent_streams = plan.get("max_concurrent_streams")
    if max_concurrent_streams is None:
        # No per-merchant override field for this in the schema today.
        # Business / Enterprise must populate this on plan_limits at
        # contract time, or extend merchant_plan_limits in a follow-up.
        raise MerchantLimitsUnresolved(
            merchant_id,
            f"max_concurrent_streams unset on plan={plan_id!r}. "
            f"Negotiate value before merchant goes live.",
        )

    max_monthly_viewer_hours_raw = _coalesce_decimal(
        override.get("max_monthly_viewer_hours"),
        plan.get("included_vh"),
    )
    if max_monthly_viewer_hours_raw is None:
        raise MerchantLimitsUnresolved(
            merchant_id,
            f"max_monthly_viewer_hours unset (plan={plan_id!r} has NULL "
            f"included_vh and no merchant_plan_limits override).",
        )

    overage_rate = plan.get("overage_rate")
    if overage_rate is None:
        raise MerchantLimitsUnresolved(
            merchant_id, f"plan_limits.overage_rate is NULL for {plan_id!r}",
        )
    hard_block_multiplier = plan.get("hard_block_multiplier")
    if hard_block_multiplier is None:
        raise MerchantLimitsUnresolved(
            merchant_id,
            f"plan_limits.hard_block_multiplier is NULL for {plan_id!r}",
        )

    max_stream_duration_min = (
        int(override["max_stream_duration_min"])
        if override.get("max_stream_duration_min") is not None
        else DEFAULT_MAX_STREAM_DURATION_MIN
    )

    return MerchantLimits(
        merchant_id=merchant_id,
        plan_id=plan_id,
        max_concurrent_viewers=int(max_concurrent_viewers),
        max_concurrent_streams=int(max_concurrent_streams),
        max_stream_duration_min=max_stream_duration_min,
        max_monthly_viewer_hours=Decimal(str(max_monthly_viewer_hours_raw)),
        overage_rate=Decimal(str(overage_rate)),
        hard_block_multiplier=Decimal(str(hard_block_multiplier)),
    )


def _coalesce_int(*vals) -> Optional[int]:
    """Return the first non-None value cast to int, or None if all NULL.

    Explicit `is not None` so a stored 0 (deliberate "no allowance") is
    honored instead of falling through to the next layer. Matches the
    pattern in services/commission.py.
    """
    for v in vals:
        if v is not None:
            return int(v)
    return None


def _coalesce_decimal(*vals) -> Optional[Decimal]:
    for v in vals:
        if v is not None:
            return Decimal(str(v))
    return None


# ─────────────────────────────────────────────────────────────────────
# Phase 3a: monthly hard-block enforcement.
#
# AWS IVS Real-Time bills per-participant-minute, ~$0.10/viewer-hour.
# A Starter merchant ($39/mo subscription) with 250 included viewer-
# hours has ~$25 of platform-paid AWS budget per month. The
# hard_block_multiplier (seeded 3.0 across all tiers) lets a merchant
# burst to 3x the included budget before we refuse new streams — i.e.
# ~$75 of AWS exposure max before runtime enforcement kicks in.
#
# This function reads merchant_monthly_usage.viewer_seconds (populated
# by services/stream_telemetry.on_stream_end since Phase 3a) and
# returns a refusal reason if the merchant has crossed
# hard_block_multiplier × max_monthly_viewer_hours.
#
# Telemetry-read failures fall OPEN (return None) rather than refuse
# every stream-start on a Supabase hiccup. The legacy in-memory + per-
# tier checks downstream still apply. Logged loudly so operator sees.
# ─────────────────────────────────────────────────────────────────────

def _current_yyyymm_utc() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m")


def check_monthly_hard_block(
    limits: MerchantLimits,
    *,
    supabase: Any,
    yyyymm: Optional[str] = None,
) -> Optional[str]:
    """Return a refusal reason if the merchant is over the monthly
    hard-block multiplier. Returns None when under the cap (stream
    or viewer-mint allowed to proceed).

    Args:
        limits: resolved MerchantLimits from resolve_merchant_limits.
        supabase: client.
        yyyymm: override current month for tests; defaults to UTC now.

    Returns:
        None if usage is OK.
        Refusal string if hard block is in effect; caller should raise
        HTTPException with the operator-actionable detail attached.
    """
    if yyyymm is None:
        yyyymm = _current_yyyymm_utc()

    try:
        usage_res = (
            supabase.table("merchant_monthly_usage")
            .select("viewer_seconds")
            .eq("merchant_id", limits.merchant_id)
            .eq("yyyymm", yyyymm)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        # Telemetry-read failure: fall open. Don't refuse every stream-
        # start on a Supabase hiccup. Per-tier concurrent checks still
        # apply downstream.
        print(
            f"[merchant_limits] monthly_hard_block read failed for "
            f"merchant={limits.merchant_id} yyyymm={yyyymm}: {exc!r}"
        )
        return None

    if not usage_res.data:
        # No usage row yet this month -> definitely under the cap.
        return None

    seconds = int(usage_res.data[0].get("viewer_seconds") or 0)
    hours_used = Decimal(seconds) / Decimal(3600)
    hard_cap_hours = limits.max_monthly_viewer_hours * limits.hard_block_multiplier

    if hours_used >= hard_cap_hours:
        return (
            f"monthly hard block: used {hours_used:.2f} viewer-hours this month, "
            f"hard cap is {hard_cap_hours:.2f} "
            f"({limits.max_monthly_viewer_hours} included × "
            f"{limits.hard_block_multiplier}x multiplier)"
        )
    return None


# ─────────────────────────────────────────────────────────────────────
# Resolve-from-Privy-DID convenience wrapper.
#
# Most gate sites (/api/ivs/create-stage, /viewer-token, /go-live)
# have the Privy DID (project owner) in hand, not the merchants.id
# UUID. This wrapper handles the lookup so callers don't reimplement
# the same query at every site.
# ─────────────────────────────────────────────────────────────────────

def resolve_merchant_limits_by_privy_did(
    owner_privy_did: str,
    *,
    supabase: Any,
) -> MerchantLimits:
    """Resolve limits for the merchant that owns this Privy DID.

    Looks up active merchants WHERE owner_privy_id = <privy_did>.
    Picks the most recent active row if multiple exist (post-canonical-
    accounts there should be at most one; this is defensive).

    Raises MerchantLimitsUnresolved on miss for any reason — same
    contract as resolve_merchant_limits.
    """
    if not owner_privy_did:
        raise MerchantLimitsUnresolved("<unknown>", "empty owner_privy_did")

    res = (
        supabase.table("merchants")
        .select("id")
        .eq("owner_privy_id", owner_privy_did)
        .eq("active", True)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise MerchantLimitsUnresolved(
            owner_privy_did,
            "no active merchants row for owner_privy_id",
        )
    return resolve_merchant_limits(res.data[0]["id"], supabase=supabase)
