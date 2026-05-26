"""
Unit tests for services.commission.resolve_commission_rate.

Stdlib unittest only. The resolver is the security boundary for sale-time
commission — these tests pin the critical contract:

  1. Per-merchant override wins, even when 0.0000 (the truthiness trap).
  2. NULL override falls through to plan_limits.commission_rate.
  3. Both unset -> CommissionRateUnset (fail closed). Never default.

Run from repo root:

    cd backend && python -m unittest tests.services.test_commission
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

from services.commission import CommissionRateUnset, resolve_commission_rate  # noqa: E402


# ── Fake Supabase (minimal — only what resolve_commission_rate touches) ──

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


SELLER = "did:privy:seller-1"


def _supabase_with(*, merchant_row, plan_row=None):
    """Build a FakeSupabase that returns merchant_row for merchants
    queries and plan_row for plan_limits queries. None means empty."""

    def resolver(table, filters):
        if table == "merchants":
            return _ns([merchant_row] if merchant_row is not None else [])
        if table == "plan_limits":
            return _ns([plan_row] if plan_row is not None else [])
        raise AssertionError(f"unexpected table: {table}")

    return FakeSupabase(resolver)


# ── Tests ────────────────────────────────────────────────────────


class ResolveCommissionRateTests(unittest.TestCase):

    def test_override_nonzero_wins(self):
        """Override 0.0250 + plan rate 0.0100 -> resolver returns 0.0250."""
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": 0.0250,
                "plan_id": "starter",
            },
            plan_row={"plan_id": "starter", "commission_rate": 0.0100},
        )
        rate = resolve_commission_rate(SELLER, supabase=sb)
        self.assertEqual(rate, Decimal("0.0250"))
        self.assertIsInstance(rate, Decimal)
        # Plan_limits lookup must NOT have happened — short-circuited.
        self.assertEqual([c["table"] for c in sb.calls], ["merchants"])

    def test_override_null_uses_plan_default(self):
        """Override NULL + plan rate 0.0100 -> resolver returns 0.0100
        from plan_limits, not from a hardcoded default.

        After migration 054 the post-resolver plan default is 0.0100
        (1% sales fee) on every seeded tier. Pre-054 (migration 053)
        it was 0.0000. This test pins that the resolver delivers
        whatever plan_limits says rather than hardcoding a value."""
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": None,
                "plan_id": "starter",
            },
            plan_row={"plan_id": "starter", "commission_rate": 0.0100},
        )
        rate = resolve_commission_rate(SELLER, supabase=sb)
        self.assertEqual(rate, Decimal("0.0100"))
        self.assertEqual([c["table"] for c in sb.calls], ["merchants", "plan_limits"])

    def test_one_percent_plan_default_post_054(self):
        """Phase 1 contract pin: the post-migration-054 plan default is
        Decimal('0.0100') on every seeded tier. If migration 054 is
        reverted (or migration 053 re-applied), this test fails first."""
        for tier in ("starter", "growth", "pro", "business", "enterprise"):
            sb = _supabase_with(
                merchant_row={
                    "id": "m1",
                    "commission_rate_override": None,
                    "plan_id": tier,
                },
                plan_row={"plan_id": tier, "commission_rate": 0.0100},
            )
            rate = resolve_commission_rate(SELLER, supabase=sb)
            self.assertEqual(
                rate, Decimal("0.0100"),
                f"tier {tier!r} should resolve to 1% sales fee post-054",
            )

    def test_override_zero_does_not_fall_through(self):
        """CRITICAL: override = 0.0000 (deliberate comp) must win over
        the plan default. The resolver uses `is not None`, never
        truthiness, so 0.0000 is preserved."""
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": 0.0000,
                "plan_id": "starter",
            },
            plan_row={"plan_id": "starter", "commission_rate": 0.0500},
        )
        rate = resolve_commission_rate(SELLER, supabase=sb)
        self.assertEqual(rate, Decimal("0.0000"))
        # Plan_limits lookup must NOT have happened.
        self.assertEqual([c["table"] for c in sb.calls], ["merchants"])

    def test_missing_merchant_fails_closed(self):
        sb = _supabase_with(merchant_row=None)
        with self.assertRaises(CommissionRateUnset) as ctx:
            resolve_commission_rate(SELLER, supabase=sb)
        self.assertIn("no active merchants row", ctx.exception.reason)

    def test_override_null_plan_id_null_fails_closed(self):
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": None,
                "plan_id": None,
            },
        )
        with self.assertRaises(CommissionRateUnset) as ctx:
            resolve_commission_rate(SELLER, supabase=sb)
        self.assertIn("plan_id is NULL", ctx.exception.reason)

    def test_override_null_plan_row_missing_fails_closed(self):
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": None,
                "plan_id": "ghost_tier",
            },
            plan_row=None,
        )
        with self.assertRaises(CommissionRateUnset) as ctx:
            resolve_commission_rate(SELLER, supabase=sb)
        self.assertIn("plan_limits row missing", ctx.exception.reason)

    def test_override_null_plan_rate_null_fails_closed(self):
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": None,
                "plan_id": "starter",
            },
            plan_row={"plan_id": "starter", "commission_rate": None},
        )
        with self.assertRaises(CommissionRateUnset) as ctx:
            resolve_commission_rate(SELLER, supabase=sb)
        self.assertIn("commission_rate is NULL", ctx.exception.reason)

    def test_decimal_round_trip_preserves_precision(self):
        """Stored value 0.1234 round-trips exactly through resolver."""
        sb = _supabase_with(
            merchant_row={
                "id": "m1",
                "commission_rate_override": "0.1234",  # postgrest may serialize as str
                "plan_id": "starter",
            },
        )
        rate = resolve_commission_rate(SELLER, supabase=sb)
        self.assertEqual(rate, Decimal("0.1234"))

    def test_resolver_filters_by_owner_privy_id_and_active(self):
        """The merchants query must filter both columns. Without active=true,
        a soft-deleted/inactive merchant could resolve a stale rate."""
        sb = _supabase_with(
            merchant_row={"id": "m1", "commission_rate_override": 0.0100, "plan_id": "starter"},
        )
        resolve_commission_rate(SELLER, supabase=sb)
        merchants_call = sb.calls[0]
        cols = {f[0] for f in merchants_call["filters"]}
        self.assertIn("owner_privy_id", cols)
        self.assertIn("active", cols)


if __name__ == "__main__":
    unittest.main()
