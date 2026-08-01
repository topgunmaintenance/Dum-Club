"""
Tests for the go-live / checkout payment gate (payment-gate fix, 2026-07-31).

Root cause being locked in: merchants.subscription_status stores Stripe's
RAW status from the webhook handler. When a trial ends with no payment
method, Stripe emits customer.subscription.paused and the row lands on
'paused' — but is_merchant_suspended() only matched the internal
'suspended' label, so a paused merchant could still go live (observed in
production 2026-07-31: Topgun Maintenance, paused Jul 28, went live Jul 31).
Separately, merchant signup inserts subscription_status='active' BEFORE any
trial checkout exists, so a merchant who abandons checkout streamed free
forever.

Run from repo root:

    cd backend && python -m unittest tests.api.test_go_live_payment_gate
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

os.environ.setdefault("SUPABASE_URL", "http://localhost-not-used")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_pretend_secret")

from api.routes import merchant  # noqa: E402


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return mock.Mock(data=self._rows)


class _FakeSupabase:
    def __init__(self, rows):
        self._rows = rows

    def table(self, name):
        assert name == "merchants"
        return _FakeQuery(self._rows)


class _ExplodingSupabase:
    def table(self, name):
        raise RuntimeError("supabase down")


def _gate(rows):
    with mock.patch.object(merchant, "get_client", return_value=_FakeSupabase(rows)):
        return merchant.is_merchant_suspended("did:privy:test")


def _row(**overrides):
    row = {
        "subscription_status": "active",
        "grandfathered": False,
        "admin_suspended": False,
        "stripe_subscription_id": "sub_123",
    }
    row.update(overrides)
    return row


class GoLivePaymentGateTests(unittest.TestCase):
    # ── The production bug ────────────────────────────────────────

    def test_paused_merchant_is_blocked(self):
        """Stripe pauses a trial that ends with no payment method; the
        webhook stores 'paused' verbatim. MUST block. This is the exact
        state Topgun Maintenance was in on 2026-07-31 when it went live."""
        self.assertTrue(_gate([_row(subscription_status="paused")]))

    def test_active_with_no_subscription_is_blocked(self):
        """Signup inserts subscription_status='active' before checkout.
        A merchant who never completed the card-upfront trial checkout has
        no Stripe subscription and MUST NOT stream."""
        self.assertTrue(
            _gate([_row(subscription_status="active", stripe_subscription_id=None)])
        )

    # ── Other blocked billing states ──────────────────────────────

    def test_suspended_merchant_is_blocked(self):
        self.assertTrue(_gate([_row(subscription_status="suspended")]))

    def test_canceled_both_spellings_blocked(self):
        self.assertTrue(_gate([_row(subscription_status="canceled")]))
        self.assertTrue(_gate([_row(subscription_status="cancelled")]))

    def test_inactive_is_blocked(self):
        self.assertTrue(_gate([_row(subscription_status="inactive")]))

    def test_status_is_case_and_whitespace_insensitive(self):
        self.assertTrue(_gate([_row(subscription_status=" Paused ")]))

    # ── Allow-list fails CLOSED on unrecognized states ────────────
    # (adversarial-review finding, 2026-07-31: the original deny-list
    # allowed 'unpaid' / 'incomplete_expired' / NULL — the same
    # vocabulary-miss failure class as the production 'paused' bug)

    def test_unpaid_is_blocked(self):
        self.assertTrue(_gate([_row(subscription_status="unpaid")]))

    def test_incomplete_states_are_blocked(self):
        self.assertTrue(_gate([_row(subscription_status="incomplete")]))
        self.assertTrue(_gate([_row(subscription_status="incomplete_expired")]))

    def test_null_status_with_subscription_is_blocked(self):
        """NULL status with a sub id is an ambiguous partial-write state;
        no recognized allow-list status → fail closed."""
        self.assertTrue(_gate([_row(subscription_status=None)]))

    def test_unknown_future_status_is_blocked(self):
        self.assertTrue(_gate([_row(subscription_status="some_future_stripe_status")]))

    def test_empty_string_subscription_id_is_blocked(self):
        self.assertTrue(
            _gate([_row(subscription_status="active", stripe_subscription_id="")])
        )

    def test_null_grandfathered_is_treated_as_not_grandfathered(self):
        self.assertTrue(
            _gate([_row(subscription_status="paused", grandfathered=None)])
        )

    # ── Allowed states ────────────────────────────────────────────

    def test_active_with_subscription_is_allowed(self):
        self.assertFalse(_gate([_row(subscription_status="active")]))

    def test_trialing_with_subscription_is_allowed(self):
        self.assertFalse(_gate([_row(subscription_status="trialing")]))

    def test_past_due_within_grace_is_allowed(self):
        """past_due means the 3-day grace window is open — by design the
        merchant keeps selling until the daily sweep flips them to
        'suspended'."""
        self.assertFalse(_gate([_row(subscription_status="past_due")]))

    # ── Exemptions & precedence ───────────────────────────────────

    def test_grandfathered_is_exempt_from_billing_checks(self):
        self.assertFalse(
            _gate([_row(subscription_status="paused", grandfathered=True,
                        stripe_subscription_id=None)])
        )

    def test_admin_suspended_trumps_grandfathering(self):
        self.assertTrue(
            _gate([_row(grandfathered=True, admin_suspended=True)])
        )

    # ── Fail-safe semantics (unchanged) ───────────────────────────

    def test_missing_merchant_row_is_allowed(self):
        """Anonymous / non-merchant callers must not be blocked."""
        self.assertFalse(_gate([]))

    def test_db_error_fails_open(self):
        with mock.patch.object(
            merchant, "get_client", return_value=_ExplodingSupabase()
        ):
            self.assertFalse(merchant.is_merchant_suspended("did:privy:test"))

    def test_no_privy_id_is_allowed(self):
        self.assertFalse(merchant.is_merchant_suspended(None))
        self.assertFalse(merchant.is_merchant_suspended(""))


if __name__ == "__main__":
    unittest.main()
