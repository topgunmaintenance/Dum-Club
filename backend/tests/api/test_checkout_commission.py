"""
Integration tests for the PR-COMM wiring inside backend/api/routes/checkout.py.

These tests exercise the actual route handlers (create_payment_intent and
sol_confirm) with a fake Supabase + a fake Stripe SDK so the resolver call,
the Decimal cents math, and the orders insert all run end to end without
talking to any real service.

Run from repo root:

    cd backend && python -m unittest tests.api.test_checkout_commission
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock


_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# Env BEFORE importing checkout (matches the existing test_checkout_sol pattern).
os.environ.setdefault("SOL_CHECKOUT_QUOTE_HMAC_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("SOLANA_RPC_URL", "http://localhost-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost-not-used")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")
os.environ.setdefault("DUM_TREASURY_WALLET", "TREASURY_PUBKEY_BASE58_LONG_ENOUGH")
os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_pretend_secret")

from api.routes import checkout  # noqa: E402
from services import solana_verify  # noqa: E402


def _fake_request():
    """Minimal stand-in for fastapi.Request.

    create_payment_intent grew a `request` parameter for per-IP checkout
    throttling (rate-limit PR); these tests pass a signed-in buyer, so the
    endpoint only reads the request when the identity is missing. A
    SimpleNamespace with a client.host satisfies client_ip_from_request if
    a future change reads it anyway.
    """
    return SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={})


# ── Fake Supabase ────────────────────────────────────────────────


class _FakeQuery:
    def __init__(self, db, table):
        self._db = db
        self._table = table
        self._filters = []
        self._action = "select"
        self._action_arg = None

    def select(self, *_a, **_kw):
        self._action = "select"
        return self

    def insert(self, payload):
        self._action = "insert"
        self._action_arg = payload
        return self

    def update(self, payload):
        self._action = "update"
        self._action_arg = payload
        return self

    def eq(self, c, v):
        self._filters.append(("eq", c, v))
        return self

    def gte(self, c, v):
        self._filters.append(("gte", c, v))
        return self

    def in_(self, c, vs):
        self._filters.append(("in", c, tuple(vs)))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def single(self):
        self._filters.append(("single", None, None))
        return self

    def execute(self):
        self._db.calls.append({
            "table": self._table,
            "action": self._action,
            "filters": list(self._filters),
            "payload": self._action_arg,
        })
        return self._db._resolve(self._table, self._action, self._filters, self._action_arg)


class FakeSupabase:
    def __init__(self, resolver):
        self.calls = []
        self._resolver = resolver

    def table(self, name):
        return _FakeQuery(self, name)

    def _resolve(self, table, action, filters, payload):
        return self._resolver(table, action, filters, payload, self.calls)


def _ns(data):
    return SimpleNamespace(data=data)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ── Fake Stripe SDK ──────────────────────────────────────────────


class FakeStripeSession:
    def __init__(self):
        self.create_calls = []
        self.modify_calls = []

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return SimpleNamespace(
            id="cs_test_FAKE_SESSION",
            payment_intent="pi_test_FAKE_PI",
            url="https://stripe.test/c/cs_test_FAKE_SESSION",
        )

    def modify(self, sid, **kwargs):
        self.modify_calls.append({"sid": sid, **kwargs})
        return SimpleNamespace(id=sid)


class FakeStripePI:
    def __init__(self):
        self.modify_calls = []

    def modify(self, pid, **kwargs):
        self.modify_calls.append({"pid": pid, **kwargs})
        return SimpleNamespace(id=pid)


class FakeStripeAccounts:
    def retrieve(self, _acct_id):
        return SimpleNamespace(charges_enabled=True, details_submitted=True)


def build_fake_stripe():
    s = SimpleNamespace()
    s.checkout = SimpleNamespace(Session=FakeStripeSession())
    s.PaymentIntent = FakeStripePI()
    s.Accounts = FakeStripeAccounts()
    return s


# ── Common test constants ────────────────────────────────────────


OFFER_ID = "offer-1"
PROJECT_ID = "project-uuid-1"
BUYER = "did:privy:buyer-1"
SELLER = "did:privy:seller-1"
MERCHANT_STRIPE_ID = "acct_TEST_CONNECT_ID"


def _stripe_path_resolver(*, override_rate, plan_rate=Decimal("0.0000")):
    """Resolver for the Stripe /create-payment-intent path. Configurable
    commission override + plan default. Returns the inserted order row
    with an id so the route can proceed."""

    offer_row = {
        "id": OFFER_ID,
        "project_id": PROJECT_ID,
        "title": "Annual Inspection",
        "description": "Test description",
        "price_usd": 100.00,
        "is_active": True,
        "quantity_sold": 0,
        "quantity_available": 0,
        "unlimited_inventory": True,
    }
    project_row = {"owner_id": SELLER, "privy_id": SELLER}
    merchant_resolver_row = {
        "id": "merchant-1",
        "commission_rate_override": (
            float(override_rate) if override_rate is not None else None
        ),
        "plan_id": "starter",
    }
    plan_row = {"plan_id": "starter", "commission_rate": float(plan_rate)}

    def resolver(table, action, filters, payload, calls):
        if table == "offers" and action == "select":
            return _ns([offer_row])
        if table == "projects" and action == "select":
            return _ns([project_row])
        if table == "users" and action == "select":
            return _ns([])
        if table == "merchants" and action == "select":
            # Two distinct merchants reads happen:
            #   1. _get_seller_stripe_connect_id selects only stripe_connect_id
            #   2. resolve_commission_rate selects id, override, plan_id
            cols = {f[1] for f in filters if f[0] == "eq"}
            if "stripe_connect_id" not in [f[1] for f in filters]:
                pass
            return _ns([{
                **merchant_resolver_row,
                "stripe_connect_id": MERCHANT_STRIPE_ID,
            }])
        if table == "plan_limits" and action == "select":
            return _ns([plan_row])
        if table == "orders" and action == "insert":
            # Stash the payload on the calls list (already done) and return id
            return _ns([{**payload, "id": "ORDER-NEW-1"}])
        if table == "orders" and action == "select":
            return _ns([])
        if table == "merchant_grace_period_state" and action == "select":
            return _ns([])
        if table == "merchant_analytics_events":
            return _ns([])
        # Default empty
        return _ns([])

    return resolver


# ── Tests ────────────────────────────────────────────────────────


class StripeCheckoutCommissionTests(unittest.TestCase):
    """Verify the Stripe /create-payment-intent path stamps the right
    fee_amount on Stripe and the right audit columns on the order."""

    def _call(self, *, override_rate, plan_rate=Decimal("0.0000")):
        fake_sb = FakeSupabase(_stripe_path_resolver(
            override_rate=override_rate, plan_rate=plan_rate,
        ))
        fake_stripe = build_fake_stripe()

        with mock.patch.object(checkout, "get_client", return_value=fake_sb), \
             mock.patch.object(checkout, "_get_stripe", return_value=fake_stripe), \
             mock.patch.object(checkout, "_assert_merchant_can_receive", lambda *a, **k: None), \
             mock.patch("api.routes.merchant.is_merchant_suspended", return_value=False):

            body = checkout.PaymentIntentRequest(
                offer_id=OFFER_ID,
                buyer_email="buyer@example.com",
                source="normal",
            )
            result = _run(checkout.create_payment_intent(body=body, request=_fake_request(), current_user={"sub": BUYER}))

        # Find the orders.insert call
        inserts = [c for c in fake_sb.calls if c["table"] == "orders" and c["action"] == "insert"]
        return result, fake_stripe, inserts[0]["payload"] if inserts else None

    def test_override_two_pct_clamps_to_doctrine_cap(self):
        """Override = 0.0200 CLAMPS to the 1.5% doctrine cap (CLAUDE.md
        §12 rule 1; audit finding 6, 2026-07-07). A billing-config write
        must never bill a seller above 1.5% — $100 charges 150 cents,
        not 200."""
        _result, fake_stripe, order_payload = self._call(
            override_rate=Decimal("0.0200"),
            plan_rate=Decimal("0.0000"),
        )
        # Stripe session.create kwargs — capped at 1.5%
        self.assertEqual(len(fake_stripe.checkout.Session.create_calls), 1)
        create_kwargs = fake_stripe.checkout.Session.create_calls[0]
        pid_data = create_kwargs["payment_intent_data"]
        self.assertEqual(pid_data["application_fee_amount"], 150)
        # Order audit columns stamp the CLAMPED rate
        self.assertEqual(order_payload["application_fee_amount_cents"], 150)
        self.assertEqual(float(order_payload["resolved_commission_rate"]), 0.015)
        # And platform_fee_usd lines up with cents/100
        self.assertEqual(order_payload["platform_fee_usd"], 1.5)
        self.assertEqual(order_payload["seller_receives_usd"], 98.5)

    def test_rate_zero_omits_application_fee_but_stamps_zero(self):
        """Rate = 0.0000 -> payment_intent_data must NOT carry
        application_fee_amount (preserves existing if > 0 guard) but the
        order still stamps cents=0 (free by intent, not by accident)."""
        _result, fake_stripe, order_payload = self._call(
            override_rate=Decimal("0.0000"),
            plan_rate=Decimal("0.0500"),  # would-be plan default; override wins
        )
        create_kwargs = fake_stripe.checkout.Session.create_calls[0]
        pid_data = create_kwargs.get("payment_intent_data", {})
        self.assertNotIn("application_fee_amount", pid_data)
        # Audit columns still set
        self.assertEqual(order_payload["application_fee_amount_cents"], 0)
        self.assertEqual(float(order_payload["resolved_commission_rate"]), 0.0)
        self.assertEqual(order_payload["platform_fee_usd"], 0.0)
        self.assertEqual(order_payload["seller_receives_usd"], 100.0)

    def test_override_null_uses_plan_default(self):
        """Override NULL + plan rate 0.0100 -> Stripe gets 100 cents."""
        _result, fake_stripe, order_payload = self._call(
            override_rate=None,
            plan_rate=Decimal("0.0100"),
        )
        create_kwargs = fake_stripe.checkout.Session.create_calls[0]
        self.assertEqual(
            create_kwargs["payment_intent_data"]["application_fee_amount"],
            100,
        )
        self.assertEqual(order_payload["application_fee_amount_cents"], 100)
        self.assertEqual(float(order_payload["resolved_commission_rate"]), 0.01)

    def test_missing_rate_returns_503_no_stripe_call(self):
        """If the resolver can't find a rate, the route raises 503 and
        Stripe is NEVER called. Fail-closed guarantee."""

        def resolver(table, action, filters, payload, calls):
            if table == "offers":
                return _ns([{
                    "id": OFFER_ID, "project_id": PROJECT_ID,
                    "title": "Test", "description": "",
                    "price_usd": 100.00, "is_active": True,
                    "quantity_sold": 0, "quantity_available": 0,
                    "unlimited_inventory": True,
                }])
            if table == "projects":
                return _ns([{"owner_id": SELLER, "privy_id": SELLER}])
            if table == "users":
                return _ns([])
            if table == "merchants":
                # Provide stripe_connect_id but NULL override + NULL plan_id
                return _ns([{
                    "id": "m1",
                    "stripe_connect_id": MERCHANT_STRIPE_ID,
                    "commission_rate_override": None,
                    "plan_id": None,
                }])
            return _ns([])

        fake_sb = FakeSupabase(resolver)
        fake_stripe = build_fake_stripe()

        with mock.patch.object(checkout, "get_client", return_value=fake_sb), \
             mock.patch.object(checkout, "_get_stripe", return_value=fake_stripe), \
             mock.patch.object(checkout, "_assert_merchant_can_receive", lambda *a, **k: None), \
             mock.patch("api.routes.merchant.is_merchant_suspended", return_value=False):

            body = checkout.PaymentIntentRequest(offer_id=OFFER_ID, source="normal")

            from fastapi import HTTPException
            with self.assertRaises(HTTPException) as ctx:
                _run(checkout.create_payment_intent(body=body, request=_fake_request(), current_user={"sub": BUYER}))

            self.assertEqual(ctx.exception.status_code, 503)
            self.assertIn("commission_rate_unset", str(ctx.exception.detail))

        # NO Stripe Session.create call
        self.assertEqual(len(fake_stripe.checkout.Session.create_calls), 0)
        # NO orders.insert call
        self.assertEqual(
            [c for c in fake_sb.calls if c["table"] == "orders" and c["action"] == "insert"],
            [],
        )

    def test_frontend_extra_field_ignored(self):
        """Pydantic v2 default is `extra=ignore`. Even if a tampered
        frontend sends `commission_rate=0.5` in the body, the field
        never reaches the resolver — the model strips it."""
        body = checkout.PaymentIntentRequest(
            **{"offer_id": OFFER_ID, "source": "normal", "commission_rate": 0.5}
        )
        # Field is absent from the model
        self.assertFalse(hasattr(body, "commission_rate"))


class WebhookNoRecomputeTests(unittest.TestCase):
    """The webhook handler must NOT recompute fees. process_order_paid only
    flips status + writes inventory/DUM/emails; it must leave resolved
    audit columns alone."""

    def test_webhook_source_does_not_touch_audit_columns(self):
        """Static check: webhook code must not reference the audit
        columns or any commission resolver. The current order's stamped
        rate is the source of truth post-session-create."""
        from api.routes.checkout import process_order_paid, stripe_webhook
        import inspect
        for fn in (process_order_paid, stripe_webhook):
            src = inspect.getsource(fn)
            self.assertNotIn(
                "resolve_commission_rate",
                src,
                msg=f"{fn.__name__} must not call the resolver (rates locked at session-create)",
            )
            self.assertNotIn(
                "application_fee_amount_cents",
                src,
                msg=f"{fn.__name__} must not rewrite application_fee_amount_cents",
            )
            self.assertNotIn(
                "resolved_commission_rate",
                src,
                msg=f"{fn.__name__} must not rewrite resolved_commission_rate",
            )


class RefundDisputeWebhookSourceTests(unittest.TestCase):
    """Static checks on the new charge.refunded / charge.dispute.*
    branches added in PR B. These confirm the routing is wired in the
    webhook source and that none of them touch fee-audit columns.

    Wired in: api/routes/checkout.py:stripe_webhook event dispatch."""

    def _webhook_source(self) -> str:
        from api.routes.checkout import stripe_webhook
        import inspect
        return inspect.getsource(stripe_webhook)

    def test_charge_refunded_branch_present(self):
        src = self._webhook_source()
        self.assertIn('"charge.refunded"', src)
        # Both outcomes — full and partial — must be expressible
        self.assertIn('"refunded"', src)
        self.assertIn('"partially_refunded"', src)

    def test_charge_dispute_created_branch_present(self):
        src = self._webhook_source()
        self.assertIn('"charge.dispute.created"', src)
        self.assertIn('"disputed"', src)

    def test_charge_dispute_closed_branch_present(self):
        src = self._webhook_source()
        self.assertIn('"charge.dispute.closed"', src)
        # Both terminal outcomes must be expressible
        self.assertIn('"chargeback"', src)
        # The "won" outcome restores to paid — covered by the existing
        # 'paid' literal elsewhere in the handler. Verify the branch
        # uses the dispute.status field rather than guessing.
        self.assertIn('"won"', src)
        self.assertIn('"lost"', src)

    def test_refund_dispute_branches_dont_touch_fee_audit_columns(self):
        """The branches must NOT recompute application_fee_amount_cents
        or resolved_commission_rate. Same rule as process_order_paid:
        once set at session-create time, those columns are immutable."""
        src = self._webhook_source()
        # The webhook source already references these strings in unrelated
        # branches (the SQL builder for the order insert in the SOL path
        # lives outside stripe_webhook). Scope the check to just the new
        # branches by extracting the slice from 'charge.refunded' to the
        # final 'else:' Unhandled branch.
        start = src.index('"charge.refunded"')
        end = src.rindex('print(f"[webhook] Unhandled event:')
        branches_slice = src[start:end]
        self.assertNotIn(
            "application_fee_amount_cents",
            branches_slice,
            msg="refund/dispute branches must not rewrite application_fee_amount_cents",
        )
        self.assertNotIn(
            "resolved_commission_rate",
            branches_slice,
            msg="refund/dispute branches must not rewrite resolved_commission_rate",
        )


class SolPathCommissionAuditTests(unittest.TestCase):
    """SOL path must stamp resolved_commission_rate (and
    application_fee_amount_cents for the audit "would-have-been" value)
    but keep platform_fee_usd=0 and seller_receives_usd=usd_amount
    unchanged. Settlement behavior is preserved per Decision C."""

    OFFER_ID = "offer-sol-1"
    PROJECT_ID = "project-sol-1"
    BUYER = "did:privy:sol-buyer"
    SELLER = "did:privy:sol-seller"
    SIG = "SOL_TX_SIG_LONG_ENOUGH_FOR_VALIDATION_AAAA"
    WALLET = "BUYER_WALLET_BASE58_LONG_ENOUGH_VALID"

    def _build_resolver(self, *, override_rate):
        offer_row = {
            "id": self.OFFER_ID,
            "project_id": self.PROJECT_ID,
            "title": "SOL Item",
            "price_usd": 50.00,
            "is_active": True,
            "quantity_sold": 0,
            "quantity_available": 0,
            "unlimited_inventory": True,
            "description": "",
        }
        project_row = {"owner_id": self.SELLER, "privy_id": self.SELLER}

        def resolver(table, action, filters, payload, calls):
            # Dedupe lookup
            if (
                table == "orders" and action == "select"
                and any(f == ("eq", "solana_tx_signature", self.SIG) for f in filters)
            ):
                return _ns([])
            if table == "offers" and action == "select":
                return _ns([offer_row])
            if table == "projects" and action == "select":
                return _ns([project_row])
            if table == "merchants" and action == "select":
                return _ns([{
                    "id": "merchant-sol-1",
                    "commission_rate_override": (
                        float(override_rate) if override_rate is not None else None
                    ),
                    "plan_id": "starter",
                }])
            if table == "plan_limits" and action == "select":
                return _ns([{"plan_id": "starter", "commission_rate": 0.0000}])
            if table == "orders" and action == "insert":
                return _ns([{**payload, "id": "ORDER-SOL-1"}])
            # Everything downstream from process_order_paid: return empty
            return _ns([])

        return resolver

    def _make_quote(self, usd_amount=50.00):
        treasury = os.environ["DUM_TREASURY_WALLET"]
        token, _ = solana_verify.make_quote_token(
            offer_id=self.OFFER_ID,
            buyer_privy_id=self.BUYER,
            lamports=int(usd_amount * 1_000),
            sol_amount=usd_amount / 100,
            usd_amount=usd_amount,
            treasury=treasury,
        )
        return token

    def test_sol_stamps_audit_rate_keeps_settlement_unchanged(self):
        """Override = 0.0300 CLAMPS to the 1.5% doctrine cap (audit
        finding 6, 2026-07-07) -> usd = $50 stamps audit cents = 75;
        platform_fee_usd stays 0 and seller_receives_usd stays $50."""
        quote = self._make_quote(usd_amount=50.00)
        fake_sb = FakeSupabase(self._build_resolver(override_rate=Decimal("0.0300")))

        body = checkout.SolConfirmRequest(
            offer_id=self.OFFER_ID,
            quote_id=quote,
            tx_signature=self.SIG,
            wallet_address=self.WALLET,
            source="sol",
        )

        with mock.patch.object(checkout, "get_client", return_value=fake_sb), \
             mock.patch.object(checkout, "verify_sol_transfer", return_value=True), \
             mock.patch.object(checkout, "process_order_paid", lambda *a, **k: None):
            _run(checkout.sol_confirm(body=body, current_user={"sub": self.BUYER}))

        inserts = [
            c for c in fake_sb.calls
            if c["table"] == "orders" and c["action"] == "insert"
        ]
        self.assertEqual(len(inserts), 1)
        payload = inserts[0]["payload"]

        # Settlement columns UNCHANGED
        self.assertEqual(payload["platform_fee_usd"], 0)
        self.assertEqual(payload["seller_receives_usd"], 50.00)
        # Audit columns STAMPED with the CLAMPED rate (doctrine cap 1.5%)
        self.assertAlmostEqual(float(payload["resolved_commission_rate"]), 0.015)
        self.assertEqual(payload["application_fee_amount_cents"], 75)

    def test_sol_audit_null_when_resolver_fails(self):
        """If the resolver can't find a rate on the SOL path, the sale
        proceeds (no behavior change) and the audit columns are NULL."""

        def resolver(table, action, filters, payload, calls):
            if table == "offers" and action == "select":
                return _ns([{
                    "id": self.OFFER_ID, "project_id": self.PROJECT_ID,
                    "title": "X", "price_usd": 50.00, "is_active": True,
                    "quantity_sold": 0, "quantity_available": 0,
                    "unlimited_inventory": True, "description": "",
                }])
            if table == "projects" and action == "select":
                return _ns([{"owner_id": self.SELLER, "privy_id": self.SELLER}])
            if table == "merchants" and action == "select":
                return _ns([])  # no merchant row -> resolver raises
            if table == "orders" and action == "select":
                return _ns([])
            if table == "orders" and action == "insert":
                return _ns([{**payload, "id": "ORDER-SOL-2"}])
            return _ns([])

        fake_sb = FakeSupabase(resolver)
        quote = self._make_quote(usd_amount=50.00)
        body = checkout.SolConfirmRequest(
            offer_id=self.OFFER_ID, quote_id=quote, tx_signature=self.SIG,
            wallet_address=self.WALLET, source="sol",
        )

        with mock.patch.object(checkout, "get_client", return_value=fake_sb), \
             mock.patch.object(checkout, "verify_sol_transfer", return_value=True), \
             mock.patch.object(checkout, "process_order_paid", lambda *a, **k: None):
            _run(checkout.sol_confirm(body=body, current_user={"sub": self.BUYER}))

        inserts = [
            c for c in fake_sb.calls
            if c["table"] == "orders" and c["action"] == "insert"
        ]
        payload = inserts[0]["payload"]
        self.assertIsNone(payload["resolved_commission_rate"])
        self.assertIsNone(payload["application_fee_amount_cents"])
        # Settlement behavior unchanged even when audit is NULL
        self.assertEqual(payload["platform_fee_usd"], 0)
        self.assertEqual(payload["seller_receives_usd"], 50.00)


if __name__ == "__main__":
    unittest.main()
