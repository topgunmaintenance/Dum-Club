"""
Tests for the Solana wallet checkout endpoints in
backend/api/routes/checkout.py.

Stdlib unittest only. The route handlers are exercised directly
(not via FastAPI TestClient) so the test suite stays offline and
doesn't require Stripe / Supabase / Privy at runtime. A small
in-memory fake of the Supabase query builder is used so
process_order_paid's 8+ table calls don't blow up — the test
asserts on its observable outputs (order status, recorded calls).

Run from repo root:

    cd backend && python -m unittest tests.api.test_checkout_sol
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock


_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# Required env BEFORE importing the modules.
os.environ.setdefault("SOL_CHECKOUT_QUOTE_HMAC_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("SOLANA_RPC_URL", "http://localhost-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost-not-used")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-key")
# DUM_TREASURY_WALLET is module-level on checkout — must be set before
# `import checkout`. The "_LONG" suffix satisfies the >20-char guard.
os.environ.setdefault("DUM_TREASURY_WALLET", "TREASURY_PUBKEY_BASE58_LONG_ENOUGH")

from api.routes import checkout  # noqa: E402
from services import solana_verify  # noqa: E402


# ── Fake Supabase ───────────────────────────────────────────────


class _FakeQuery:
    """Minimal builder mock — every method returns self until
    .execute(), which returns a SimpleNamespace(data=...). The
    behaviour for each table+filter combination is pre-programmed
    by the test via FakeSupabase.expect()."""

    def __init__(self, fake_db: "FakeSupabase", table: str):
        self._db = fake_db
        self._table = table
        self._filters: list[tuple] = []
        self._action: str = "select"
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

    def eq(self, column, value):
        self._filters.append(("eq", column, value))
        return self

    def gte(self, column, value):
        self._filters.append(("gte", column, value))
        return self

    def in_(self, column, values):
        self._filters.append(("in", column, tuple(values)))
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
    """Routes table().<verb>().<filters>().execute() through a
    user-supplied resolver. Records every call for assertions."""

    def __init__(self, resolver):
        self.calls: list[dict] = []
        self._resolver = resolver

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)

    def _resolve(self, table, action, filters, payload):
        return self._resolver(table, action, filters, payload, self.calls)


def _ns(data):
    return SimpleNamespace(data=data)


# ── Helpers ──────────────────────────────────────────────────────


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _make_quote(
    *,
    offer_id="offer-1",
    buyer_privy_id="did:privy:user-1",
    lamports=1_000_000,
    sol_amount=0.001,
    usd_amount=1.50,
    treasury=None,
    now_ts=None,
):
    treasury = treasury or os.environ["DUM_TREASURY_WALLET"]
    token, exp = solana_verify.make_quote_token(
        offer_id=offer_id,
        buyer_privy_id=buyer_privy_id,
        lamports=lamports,
        sol_amount=sol_amount,
        usd_amount=usd_amount,
        treasury=treasury,
        now_ts=now_ts,
    )
    return token, exp


# ── Tests ────────────────────────────────────────────────────────


class SolConfirmTests(unittest.TestCase):
    OFFER_ID = "offer-1"
    PROJECT_ID = "project-uuid-1"
    BUYER = "did:privy:user-1"
    SELLER = "did:privy:seller-1"
    SIG = "REAL_LOOKING_SIG_LONG_ENOUGH_AAAAAAAAAA"
    WALLET = "BUYER_WALLET_BASE58_LONG_ENOUGH_TOO"

    def _resolver(self, *, dup=False, offer_active=True, project_found=True):
        """Build a Supabase resolver tailored to a single test."""
        offer_row = {
            "id": self.OFFER_ID,
            "project_id": self.PROJECT_ID,
            "title": "Annual Inspection",
            "price_usd": 1.50,
            "is_active": offer_active,
            "quantity_sold": 0,
            "quantity_available": 0,
            "unlimited_inventory": True,
            "description": "",
        }
        project_row = {"owner_id": self.SELLER, "privy_id": self.SELLER}
        full_order_row = {
            "id": "ORDER-NEW-1",
            "offer_id": self.OFFER_ID,
            "project_id": self.PROJECT_ID,
            "buyer_user_id": self.BUYER,
            "seller_user_id": self.SELLER,
            "amount_paid_usd": 1.50,
            "seller_receives_usd": 1.50,
            "status": "pending_payment",
            "buyer_email": "buyer@example.com",
            "offers": {
                "title": "Annual Inspection",
                "price_usd": 1.50,
                "project_id": self.PROJECT_ID,
            },
        }

        def resolver(table, action, filters, payload, calls):
            # 1. Dedupe lookup on orders.solana_tx_signature.
            if (
                table == "orders"
                and action == "select"
                and any(f == ("eq", "solana_tx_signature", self.SIG) for f in filters)
            ):
                return _ns([{"id": "OLD-ORDER"}] if dup else [])

            # 2. Offer lookup.
            if (
                table == "offers"
                and action == "select"
                and any(f == ("eq", "id", self.OFFER_ID) for f in filters)
                and any(f == ("eq", "is_active", True) for f in filters)
            ):
                return _ns([offer_row] if offer_active else [])

            # 3. Project lookup (seller resolution).
            if (
                table == "projects"
                and action == "select"
                and any(f == ("eq", "id", self.PROJECT_ID) for f in filters)
            ):
                return _ns([project_row] if project_found else [])

            # 4. Order insert — return the freshly-inserted row.
            if table == "orders" and action == "insert":
                return _ns([{
                    **payload,
                    "id": "ORDER-NEW-1",
                }])

            # 5. process_order_paid: order update (status=paid).
            if table == "orders" and action == "update":
                return _ns([{"id": "ORDER-NEW-1", **payload}])

            # 6. process_order_paid: re-read full order with offers join.
            if (
                table == "orders"
                and action == "select"
                and any(f == ("eq", "id", "ORDER-NEW-1") for f in filters)
            ):
                return _ns(full_order_row)

            # 7. process_order_paid: offer lookup for inventory bump.
            if (
                table == "offers"
                and action == "select"
                and any(f == ("eq", "id", self.OFFER_ID) for f in filters)
                and not any(f == ("eq", "is_active", True) for f in filters)
            ):
                return _ns([{
                    "id": self.OFFER_ID,
                    "project_id": self.PROJECT_ID,
                    "quantity_sold": 0,
                    "quantity_available": 0,
                    "unlimited_inventory": True,
                }])

            # 8. process_order_paid: offers.update (quantity_sold+1).
            if table == "offers" and action == "update":
                return _ns([{}])

            # 9. project name lookup for emails.
            if (
                table == "projects"
                and action == "select"
                and any(f[1] == "id" for f in filters)
            ):
                return _ns([{"title": "Topgun Maintenance"}])

            # 10. users / dum_transactions / profiles — return empty so
            # process_order_paid's optional resolvers no-op gracefully.
            if table == "users" and action == "select":
                return _ns([{"dum_balance": 0, "email": "buyer@example.com"}])
            if table == "users" and action == "update":
                return _ns([{}])
            if table == "dum_transactions" and action == "insert":
                return _ns([{}])
            if table == "profiles" and action == "select":
                return _ns([])

            # Default: empty response.
            return _ns([])

        return resolver

    def _confirm_body(self, tx_signature=None, quote=None, source="sol"):
        return checkout.SolConfirmRequest(
            offer_id=self.OFFER_ID,
            quote_id=quote or _make_quote(offer_id=self.OFFER_ID, buyer_privy_id=self.BUYER)[0],
            tx_signature=tx_signature or self.SIG,
            wallet_address=self.WALLET,
            source=source,
        )

    # ── Quote endpoint ──────────────────────────────────────────

    def test_sol_quote_happy_path(self) -> None:
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(solana_verify, "get_sol_usd_price", return_value=200.0):
            res = _run(checkout.sol_quote(
                checkout.SolQuoteRequest(offer_id=self.OFFER_ID),
                current_user={"sub": self.BUYER},
            ))
        self.assertIn("quote_id", res)
        self.assertGreater(res["lamports"], 0)
        self.assertEqual(res["usd_amount"], 1.50)
        self.assertEqual(res["treasury"], os.environ["DUM_TREASURY_WALLET"])

    def test_sol_quote_offer_not_found(self) -> None:
        fake = FakeSupabase(self._resolver(offer_active=False))
        with mock.patch.object(checkout, "get_client", return_value=fake):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_quote(
                    checkout.SolQuoteRequest(offer_id=self.OFFER_ID),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 404)

    # ── Confirm endpoint ────────────────────────────────────────

    def test_sol_confirm_happy_path_creates_paid_order(self) -> None:
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(checkout, "verify_sol_transfer", return_value=True), \
             mock.patch.object(checkout, "broadcast_sync", return_value=None), \
             mock.patch.object(checkout, "send_buyer_payment_confirmed", return_value=None), \
             mock.patch.object(checkout, "send_seller_new_order", return_value=None):
            res = _run(checkout.sol_confirm(
                self._confirm_body(),
                current_user={"sub": self.BUYER},
            ))

        self.assertEqual(res["status"], "paid")
        self.assertEqual(res["tx_signature"], self.SIG)

        # Order was inserted with the right SOL fields and status.
        inserts = [c for c in fake.calls if c["table"] == "orders" and c["action"] == "insert"]
        self.assertEqual(len(inserts), 1)
        payload = inserts[0]["payload"]
        self.assertEqual(payload["solana_tx_signature"], self.SIG)
        self.assertEqual(payload["solana_buyer_wallet"], self.WALLET)
        self.assertGreater(payload["solana_lamports"], 0)
        self.assertEqual(payload["status"], "pending_payment")
        self.assertEqual(payload["source"], "sol")
        self.assertEqual(payload["platform_fee_usd"], 0)

        # Order was then updated to paid by process_order_paid.
        updates = [c for c in fake.calls if c["table"] == "orders" and c["action"] == "update"]
        self.assertTrue(any(u["payload"].get("status") == "paid" for u in updates))

    def test_sol_confirm_rejects_duplicate_signature(self) -> None:
        fake = FakeSupabase(self._resolver(dup=True))
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(checkout, "verify_sol_transfer", return_value=True):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_sol_confirm_rejects_expired_quote(self) -> None:
        # Issue a quote in the past so the embedded `exp` is already past.
        old_token, _ = _make_quote(
            offer_id=self.OFFER_ID,
            buyer_privy_id=self.BUYER,
            now_ts=1,  # epoch second 1 → exp = 91, far in the past
        )
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(checkout, "verify_sol_transfer", return_value=True):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(quote=old_token),
                    current_user={"sub": self.BUYER},
                ))
        # 410 Gone: explicit FE signal to re-fetch a fresh quote.
        self.assertEqual(ctx.exception.status_code, 410)

    def test_sol_confirm_rejects_bad_signature(self) -> None:
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(
                 checkout,
                 "verify_sol_transfer",
                 return_value="SOL was not received by the DUM Club treasury.",
             ):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("treasury", str(ctx.exception.detail).lower())

    def test_sol_confirm_rejects_amount_mismatch(self) -> None:
        # verify_sol_transfer returns the amount-mismatch string in
        # the real RPC path; here we just simulate that return value.
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(
                 checkout,
                 "verify_sol_transfer",
                 return_value="SOL was not received by the DUM Club treasury. Check the destination address.",
             ):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_sol_confirm_rejects_sender_mismatch(self) -> None:
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake), \
             mock.patch.object(
                 checkout,
                 "verify_sol_transfer",
                 return_value="Transaction was not sent from the wallet you claimed.",
             ):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("wallet", str(ctx.exception.detail).lower())

    def test_sol_confirm_rejects_invalid_source(self) -> None:
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(source="bogus_source"),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_sol_confirm_rejects_short_signature(self) -> None:
        fake = FakeSupabase(self._resolver())
        with mock.patch.object(checkout, "get_client", return_value=fake):
            with self.assertRaises(checkout.HTTPException) as ctx:
                _run(checkout.sol_confirm(
                    self._confirm_body(tx_signature="short"),
                    current_user={"sub": self.BUYER},
                ))
        self.assertEqual(ctx.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
