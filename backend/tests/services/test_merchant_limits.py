"""
Unit tests for services.merchant_limits.resolve_merchant_limits.

Stdlib unittest only. The resolver is the security boundary for live-
stream cap enforcement — these tests pin the critical contract:

  1. Plan-default path returns the right caps for Starter / Growth / Pro.
  2. Per-merchant override wins per field (NULL falls through).
  3. Business / Enterprise with NULL plan caps AND no override -> raise.
     (Doctrine: migration 049 "fail closed on a NULL cap").
  4. Inactive merchant -> raise.
  5. Missing merchant -> raise.
  6. Missing plan_limits row -> raise.

Run from repo root:

    cd backend && python -m unittest tests.services.test_merchant_limits
"""

from __future__ import annotations

import os
import sys
import unittest
from decimal import Decimal
from types import SimpleNamespace


_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from services.merchant_limits import (  # noqa: E402
    MerchantLimits,
    MerchantLimitsUnresolved,
    resolve_merchant_limits,
    check_monthly_hard_block,
    DEFAULT_MAX_STREAM_DURATION_MIN,
)


# ── Fake Supabase (matching the test_commission.py shape) ────────────

class _FakeQuery:
    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._filters = []

    def select(self, *_a, **_kw):
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        self._db.calls.append({"table": self._table, "filters": list(self._filters)})
        return self._db._resolve(self._table, self._filters)


class FakeSupabase:
    def __init__(self, resolver):
        self.calls: list[dict] = []
        self._resolver = resolver

    def table(self, name):
        return _FakeQuery(self, name)

    def _resolve(self, table, filters):
        return self._resolver(table, filters)


def _ns(data):
    return SimpleNamespace(data=data)


MID = "merchant-uuid-1"


def _supabase_with(*, merchant_row, plan_row=None, override_row=None):
    def resolver(table, filters):
        if table == "merchants":
            return _ns([merchant_row] if merchant_row is not None else [])
        if table == "merchant_plan_limits":
            return _ns([override_row] if override_row is not None else [])
        if table == "plan_limits":
            return _ns([plan_row] if plan_row is not None else [])
        raise AssertionError(f"unexpected table: {table}")

    return FakeSupabase(resolver)


# Seeded plan rows mirroring migrations 049/054 production state.
PLAN_STARTER = {
    "plan_id": "starter", "included_vh": Decimal("250"),
    "max_concurrent": 250, "max_concurrent_streams": 1,
    "overage_rate": Decimal("0.13"), "hard_block_multiplier": Decimal("3.0"),
}
PLAN_GROWTH = {
    "plan_id": "growth", "included_vh": Decimal("700"),
    "max_concurrent": 600, "max_concurrent_streams": 1,
    "overage_rate": Decimal("0.12"), "hard_block_multiplier": Decimal("3.0"),
}
PLAN_PRO = {
    "plan_id": "pro", "included_vh": Decimal("1500"),
    "max_concurrent": 2000, "max_concurrent_streams": 3,
    "overage_rate": Decimal("0.10"), "hard_block_multiplier": Decimal("3.0"),
}
PLAN_BUSINESS = {
    "plan_id": "business", "included_vh": None,
    "max_concurrent": None, "max_concurrent_streams": None,
    "overage_rate": Decimal("0.10"), "hard_block_multiplier": Decimal("3.0"),
}


class TestPlanDefaultPath(unittest.TestCase):

    def test_starter_returns_seeded_caps(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "starter", "active": True},
            plan_row=PLAN_STARTER,
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.plan_id, "starter")
        self.assertEqual(limits.max_concurrent_viewers, 250)
        self.assertEqual(limits.max_concurrent_streams, 1)
        self.assertEqual(limits.max_monthly_viewer_hours, Decimal("250"))
        self.assertEqual(limits.overage_rate, Decimal("0.13"))
        self.assertEqual(limits.hard_block_multiplier, Decimal("3.0"))
        # No override row -> default duration cap.
        self.assertEqual(
            limits.max_stream_duration_min, DEFAULT_MAX_STREAM_DURATION_MIN
        )

    def test_growth_returns_seeded_caps(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "growth", "active": True},
            plan_row=PLAN_GROWTH,
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.max_concurrent_viewers, 600)
        self.assertEqual(limits.max_concurrent_streams, 1)
        self.assertEqual(limits.overage_rate, Decimal("0.12"))

    def test_pro_returns_seeded_caps(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "pro", "active": True},
            plan_row=PLAN_PRO,
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.max_concurrent_viewers, 2000)
        self.assertEqual(limits.max_concurrent_streams, 3)
        self.assertEqual(limits.max_monthly_viewer_hours, Decimal("1500"))


class TestMerchantOverridePath(unittest.TestCase):

    def test_override_max_concurrent_viewers_wins(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "starter", "active": True},
            plan_row=PLAN_STARTER,
            override_row={
                "max_concurrent_viewers": 100,           # tightens Starter's 250
                "max_stream_duration_min": None,
                "max_streams_per_day": None,
                "max_monthly_viewer_hours": None,
            },
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.max_concurrent_viewers, 100)
        # other fields fall through to plan
        self.assertEqual(limits.max_monthly_viewer_hours, Decimal("250"))

    def test_override_with_zero_is_honored(self):
        """An explicit zero override must NOT fall through (the
        truthiness trap from commission.py)."""
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "starter", "active": True},
            plan_row=PLAN_STARTER,
            override_row={
                "max_concurrent_viewers": 0,             # comp / paused
                "max_stream_duration_min": None,
                "max_streams_per_day": None,
                "max_monthly_viewer_hours": None,
            },
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.max_concurrent_viewers, 0)

    def test_override_monthly_viewer_hours_wins(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "growth", "active": True},
            plan_row=PLAN_GROWTH,
            override_row={
                "max_concurrent_viewers": None,
                "max_stream_duration_min": 120,
                "max_streams_per_day": None,
                "max_monthly_viewer_hours": 1000,         # Growth normally 700
            },
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.max_concurrent_viewers, 600)   # falls through
        self.assertEqual(limits.max_monthly_viewer_hours, Decimal("1000"))
        self.assertEqual(limits.max_stream_duration_min, 120)


class TestFailClosed(unittest.TestCase):

    def test_business_with_null_plan_caps_and_no_override_raises(self):
        """Migration 049 doctrine: NULL on Business/Enterprise plan caps
        means resolve per merchant, NEVER unlimited. Must fail closed
        when the override is also missing."""
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "business", "active": True},
            plan_row=PLAN_BUSINESS,
        )
        with self.assertRaises(MerchantLimitsUnresolved) as ctx:
            resolve_merchant_limits(MID, supabase=sb)
        self.assertIn("max_concurrent_viewers unset", ctx.exception.reason)

    def test_business_with_partial_override_resolves(self):
        """Business with merchant_plan_limits filled for the NULL caps
        on the plan should resolve cleanly."""
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "business", "active": True},
            plan_row={
                **PLAN_BUSINESS,
                "max_concurrent_streams": 5,   # contracted value
            },
            override_row={
                "max_concurrent_viewers": 5000,
                "max_stream_duration_min": 240,
                "max_streams_per_day": None,
                "max_monthly_viewer_hours": 10000,
            },
        )
        limits = resolve_merchant_limits(MID, supabase=sb)
        self.assertEqual(limits.max_concurrent_viewers, 5000)
        self.assertEqual(limits.max_concurrent_streams, 5)
        self.assertEqual(limits.max_monthly_viewer_hours, Decimal("10000"))
        self.assertEqual(limits.max_stream_duration_min, 240)

    def test_inactive_merchant_raises(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "starter", "active": False},
            plan_row=PLAN_STARTER,
        )
        with self.assertRaises(MerchantLimitsUnresolved) as ctx:
            resolve_merchant_limits(MID, supabase=sb)
        self.assertIn("inactive", ctx.exception.reason)

    def test_missing_merchant_raises(self):
        sb = _supabase_with(merchant_row=None)
        with self.assertRaises(MerchantLimitsUnresolved):
            resolve_merchant_limits(MID, supabase=sb)

    def test_null_plan_id_raises(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": None, "active": True},
        )
        with self.assertRaises(MerchantLimitsUnresolved) as ctx:
            resolve_merchant_limits(MID, supabase=sb)
        self.assertIn("plan_id is NULL", ctx.exception.reason)

    def test_missing_plan_limits_row_raises(self):
        sb = _supabase_with(
            merchant_row={"id": MID, "plan_id": "phantom", "active": True},
            plan_row=None,
        )
        with self.assertRaises(MerchantLimitsUnresolved) as ctx:
            resolve_merchant_limits(MID, supabase=sb)
        self.assertIn("plan_limits row missing", ctx.exception.reason)


def _starter_limits():
    return MerchantLimits(
        merchant_id=MID,
        plan_id="starter",
        max_concurrent_viewers=250,
        max_concurrent_streams=1,
        max_stream_duration_min=60,
        max_monthly_viewer_hours=Decimal("250"),
        overage_rate=Decimal("0.13"),
        hard_block_multiplier=Decimal("3.0"),
    )


def _supabase_with_usage(*, viewer_seconds):
    """FakeSupabase whose merchant_monthly_usage returns a single row
    with the given viewer_seconds. Other tables return empty."""
    def resolver(table, filters):
        if table == "merchant_monthly_usage":
            if viewer_seconds is None:
                return _ns([])
            return _ns([{"viewer_seconds": viewer_seconds}])
        return _ns([])
    return FakeSupabase(resolver)


class TestMonthlyHardBlock(unittest.TestCase):

    def test_under_cap_returns_none(self):
        # Starter: 250 included × 3.0 multiplier = 750 hard cap = 2,700,000 seconds.
        # 100 viewer-hours = 360,000 seconds, well under.
        sb = _supabase_with_usage(viewer_seconds=360_000)
        self.assertIsNone(check_monthly_hard_block(_starter_limits(), supabase=sb))

    def test_no_usage_row_returns_none(self):
        sb = _supabase_with_usage(viewer_seconds=None)
        self.assertIsNone(check_monthly_hard_block(_starter_limits(), supabase=sb))

    def test_at_hard_cap_refuses(self):
        # Exactly at 750 viewer-hours = 2,700,000 seconds.
        sb = _supabase_with_usage(viewer_seconds=2_700_000)
        reason = check_monthly_hard_block(_starter_limits(), supabase=sb)
        self.assertIsNotNone(reason)
        self.assertIn("hard block", reason.lower())
        self.assertIn("750", reason)  # hard cap printed
        self.assertIn("250", reason)  # included printed

    def test_over_hard_cap_refuses(self):
        # 1000 viewer-hours, way over the 750 hard cap.
        sb = _supabase_with_usage(viewer_seconds=3_600_000)
        reason = check_monthly_hard_block(_starter_limits(), supabase=sb)
        self.assertIsNotNone(reason)

    def test_one_second_under_cap_passes(self):
        # 2,699,999 = just under 750-hour hard cap.
        sb = _supabase_with_usage(viewer_seconds=2_699_999)
        self.assertIsNone(check_monthly_hard_block(_starter_limits(), supabase=sb))

    def test_pro_higher_hard_cap(self):
        # Pro: 1500 × 3.0 = 4500 viewer-hours = 16,200,000 seconds.
        pro_limits = MerchantLimits(
            merchant_id=MID, plan_id="pro",
            max_concurrent_viewers=2000, max_concurrent_streams=3,
            max_stream_duration_min=60,
            max_monthly_viewer_hours=Decimal("1500"),
            overage_rate=Decimal("0.10"), hard_block_multiplier=Decimal("3.0"),
        )
        # 5000 vh = 18,000,000 seconds = over the 4500 hard cap.
        sb = _supabase_with_usage(viewer_seconds=18_000_000)
        self.assertIsNotNone(check_monthly_hard_block(pro_limits, supabase=sb))
        # 4499 vh, just under.
        sb_under = _supabase_with_usage(viewer_seconds=int(4499 * 3600))
        self.assertIsNone(check_monthly_hard_block(pro_limits, supabase=sb_under))

    def test_zero_viewer_seconds_passes(self):
        sb = _supabase_with_usage(viewer_seconds=0)
        self.assertIsNone(check_monthly_hard_block(_starter_limits(), supabase=sb))

    def test_read_failure_falls_open(self):
        """A Supabase outage during cap-read must NOT refuse every
        stream-start. Returns None (fall open) and logs."""
        def resolver(table, filters):
            raise RuntimeError("simulated Supabase outage")
        sb = FakeSupabase(resolver)
        # Must not raise.
        result = check_monthly_hard_block(_starter_limits(), supabase=sb)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
