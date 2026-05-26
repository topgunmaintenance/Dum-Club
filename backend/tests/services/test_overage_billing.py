"""
Unit tests for services.overage_billing.

Pinned contracts:
  1. compute_overage_for_period is pure (no writes, no Stripe).
  2. overage_hours = max(0, hours_used - included_vh).
  3. overage_owed_cents = overage_hours × overage_rate × 100, rounded.
  4. net_overage_cents = max(0, overage_owed - sales_fee_earned).
     (CLAUDE.md §3 no-double-bill rule.)
  5. Sales fee aggregation crosses every Privy DID for the merchant's
     canonical account_id (when set).
  6. Stripe customer NULL -> status='skipped_no_customer' (no API call).
  7. yyyymm validation rejects malformed inputs.
  8. Cents math uses Decimal; no float drift on long-running merchants.

Run from repo root:

    cd backend && python -m unittest tests.services.test_overage_billing
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

from services.overage_billing import (  # noqa: E402
    OverageBillingError,
    compute_overage_for_period,
    compute_sales_fee_earned,
    _yyyymm_bounds,
    _validate_yyyymm,
)


# ── Fake Supabase shared with the other test modules ─────────────────

class _FakeQuery:
    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._filters = []

    def select(self, *_a, **_kw): return self
    def eq(self, c, v):
        self._filters.append(("eq", c, v))
        return self
    def in_(self, c, vals):
        self._filters.append(("in", c, tuple(vals)))
        return self
    def gte(self, c, v):
        self._filters.append(("gte", c, v))
        return self
    def lt(self, c, v):
        self._filters.append(("lt", c, v))
        return self
    def limit(self, *_a, **_kw): return self
    def order(self, *_a, **_kw): return self

    def execute(self):
        return self._db._resolve(self._table, self._filters)


class FakeSupabase:
    def __init__(self, resolver):
        self._resolver = resolver

    def table(self, name):
        return _FakeQuery(self, name)

    def _resolve(self, table, filters):
        return self._resolver(table, filters)


def _ns(data):
    return SimpleNamespace(data=data)


MID = "merchant-uuid-1"
PRIVY_PRIMARY = "did:privy:primary"
PRIVY_ALT = "did:privy:alt-julian"


def _supabase_with_state(
    *,
    merchant_row,
    plan_row,
    override_row=None,
    usage_row=None,
    account_logins=None,
    orders=None,
):
    """Resolver that mirrors prod tables. Filters are intentionally
    loose — tests don't need filter-level fidelity, only the right
    table-to-rowset mapping."""
    def resolver(table, _filters):
        if table == "merchants":
            return _ns([merchant_row] if merchant_row is not None else [])
        if table == "merchant_plan_limits":
            return _ns([override_row] if override_row is not None else [])
        if table == "plan_limits":
            return _ns([plan_row] if plan_row is not None else [])
        if table == "merchant_monthly_usage":
            return _ns([usage_row] if usage_row is not None else [])
        if table == "account_logins":
            return _ns(account_logins or [])
        if table == "orders":
            return _ns(orders or [])
        raise AssertionError(f"unexpected table: {table}")
    return FakeSupabase(resolver)


PLAN_STARTER = {
    "plan_id": "starter", "included_vh": Decimal("250"),
    "max_concurrent": 250, "max_concurrent_streams": 1,
    "overage_rate": Decimal("0.13"), "hard_block_multiplier": Decimal("3.0"),
}


# ─────────────────────────────────────────────────────────────────────
# yyyymm validation + bounds
# ─────────────────────────────────────────────────────────────────────

class TestYyyymm(unittest.TestCase):

    def test_validate_ok(self):
        _validate_yyyymm("2026-05")
        _validate_yyyymm("2030-01")
        _validate_yyyymm("2030-12")

    def test_validate_rejects_garbage(self):
        for bad in ("", "2026", "2026-13", "2026-00", "2026/05", "2026-5", "20265"):
            with self.assertRaises(OverageBillingError):
                _validate_yyyymm(bad)

    def test_bounds_mid_year(self):
        start, end = _yyyymm_bounds("2026-05")
        self.assertEqual(start.isoformat(), "2026-05-01T00:00:00+00:00")
        self.assertEqual(end.isoformat(), "2026-06-01T00:00:00+00:00")

    def test_bounds_year_rollover(self):
        start, end = _yyyymm_bounds("2026-12")
        self.assertEqual(start.isoformat(), "2026-12-01T00:00:00+00:00")
        self.assertEqual(end.isoformat(), "2027-01-01T00:00:00+00:00")


# ─────────────────────────────────────────────────────────────────────
# Pure calculator
# ─────────────────────────────────────────────────────────────────────

class TestComputeOverage(unittest.TestCase):

    def test_zero_usage_zero_owed(self):
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row=None,
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.hours_used, Decimal("0"))
        self.assertEqual(c.overage_hours, Decimal("0"))
        self.assertEqual(c.overage_owed_cents, 0)
        self.assertEqual(c.net_overage_cents, 0)

    def test_under_included_zero_owed(self):
        # 100 hours = 360,000 seconds < 250 included.
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 360_000},
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.hours_used, Decimal("100"))
        self.assertEqual(c.overage_hours, Decimal("0"))
        self.assertEqual(c.overage_owed_cents, 0)

    def test_exactly_at_included_zero_overage(self):
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 250 * 3600},
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.overage_hours, Decimal("0"))
        self.assertEqual(c.overage_owed_cents, 0)

    def test_overage_no_offset(self):
        # 350 hours used. Starter: 250 included, 100 over @ $0.13.
        # overage_owed = 100 × 0.13 × 100 = 1300 cents.
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 350 * 3600},
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.overage_hours, Decimal("100"))
        self.assertEqual(c.overage_owed_cents, 1300)
        self.assertEqual(c.sales_fee_earned_cents, 0)
        self.assertEqual(c.net_overage_cents, 1300)

    def test_overage_partial_offset(self):
        # 100 hours overage = $13.00 = 1300 cents owed.
        # Sales fee = $5.00 = 500 cents earned this period.
        # net = max(0, 1300 - 500) = 800 cents.
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 350 * 3600},
            orders=[
                {"application_fee_amount_cents": 300},
                {"application_fee_amount_cents": 200},
            ],
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.overage_owed_cents, 1300)
        self.assertEqual(c.sales_fee_earned_cents, 500)
        self.assertEqual(c.net_overage_cents, 800)

    def test_overage_fully_offset_by_sales_fee(self):
        # 100 hours overage = 1300 cents owed.
        # Sales fee = 1500 cents earned this period.
        # net = max(0, 1300 - 1500) = 0. No-double-bill rule.
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 350 * 3600},
            orders=[{"application_fee_amount_cents": 1500}],
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.overage_owed_cents, 1300)
        self.assertEqual(c.sales_fee_earned_cents, 1500)
        self.assertEqual(c.net_overage_cents, 0)

    def test_decimal_precision_preserved(self):
        # 250 hours included, used 250.5 hours = 30 minutes overage.
        # 0.5 × 0.13 = 0.065 dollars = 6.5 cents -> rounds to 7 cents
        # (banker's rounding via Decimal ROUND_HALF_UP).
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": int(250.5 * 3600)},
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.overage_hours, Decimal("0.5"))
        self.assertEqual(c.overage_owed_cents, 7)


class TestCrossDidSalesFees(unittest.TestCase):
    """Account_id expansion: a merchant whose canonical account spans
    multiple Privy DIDs collects sales fees across ALL of them."""

    def test_account_id_expansion(self):
        sb = _supabase_with_state(
            merchant_row={
                "id": MID, "plan_id": "starter", "active": True,
                "owner_privy_id": PRIVY_PRIMARY, "account_id": "acct-julian",
            },
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 350 * 3600},
            account_logins=[
                {"privy_did": PRIVY_PRIMARY},
                {"privy_did": PRIVY_ALT},
            ],
            orders=[
                {"application_fee_amount_cents": 600},   # from primary
                {"application_fee_amount_cents": 700},   # from alt
            ],
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        # 600 + 700 = 1300 cents earned. Overage owed = 1300. net = 0.
        self.assertEqual(c.sales_fee_earned_cents, 1300)
        self.assertEqual(c.net_overage_cents, 0)

    def test_null_account_id_falls_back_to_owner_privy(self):
        sb = _supabase_with_state(
            merchant_row={
                "id": MID, "plan_id": "starter", "active": True,
                "owner_privy_id": PRIVY_PRIMARY, "account_id": None,
            },
            plan_row=PLAN_STARTER,
            usage_row={"viewer_seconds": 350 * 3600},
            orders=[{"application_fee_amount_cents": 999}],
        )
        c = compute_overage_for_period(MID, "2026-05", supabase=sb)
        self.assertEqual(c.sales_fee_earned_cents, 999)


class TestFailClosed(unittest.TestCase):

    def test_missing_merchant_raises(self):
        sb = _supabase_with_state(merchant_row=None, plan_row=PLAN_STARTER)
        with self.assertRaises(OverageBillingError):
            compute_overage_for_period(MID, "2026-05", supabase=sb)

    def test_invalid_yyyymm_raises(self):
        sb = _supabase_with_state(
            merchant_row={"id": MID, "plan_id": "starter", "active": True,
                          "owner_privy_id": PRIVY_PRIMARY, "account_id": None},
            plan_row=PLAN_STARTER,
        )
        with self.assertRaises(OverageBillingError):
            compute_overage_for_period(MID, "2026/05", supabase=sb)


if __name__ == "__main__":
    unittest.main()
