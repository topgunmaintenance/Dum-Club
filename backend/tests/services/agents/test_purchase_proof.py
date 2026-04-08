"""
Tests for PurchaseProofAgent.

Stdlib unittest only — no pytest, no new deps. Every dependency (Supabase,
clock) is injected so these tests run fully offline and deterministically.

Run from repo root:

    cd backend && python -m unittest tests.services.agents.test_purchase_proof
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from services.agents.purchase_proof import (  # noqa: E402
    APPROVE_THRESHOLD,
    REVIEW_THRESHOLD,
    VELOCITY_MAX,
    PurchaseProofAgent,
)


# ── Fakes ───────────────────────────────────────────────────────────────


class _FakeQuery:
    def __init__(self, data):
        self._data = data

    def select(self, *a, **kw):
        return self

    def eq(self, *a, **kw):
        return self

    def gte(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


class _FakeSupabase:
    """
    Route the .table(name) call to per-table canned results so tests can
    control each query independently.
    """

    def __init__(
        self,
        businesses=None,          # list of rows returned for external_businesses lookup
        duplicates=None,          # list of rows returned for purchase_proofs dedup lookup
        velocity_rows=None,       # list of rows returned for purchase_proofs velocity lookup
    ):
        self._businesses = businesses or []
        self._duplicates = duplicates or []
        self._velocity_rows = velocity_rows or []
        # purchase_proofs is queried for BOTH dedup and velocity — we serve
        # them in order: first call = dedup, subsequent call = velocity.
        self._proofs_call_count = 0

    def table(self, name: str):
        if name == "external_businesses":
            return _FakeQuery(self._businesses)
        if name == "purchase_proofs":
            self._proofs_call_count += 1
            if self._proofs_call_count == 1:
                return _FakeQuery(self._duplicates)
            return _FakeQuery(self._velocity_rows)
        return _FakeQuery([])


def _fixed_now():
    """Deterministic clock anchored to a known date."""
    return datetime(2026, 4, 8, 12, 0, 0, tzinfo=timezone.utc)


def _agent(sb):
    return PurchaseProofAgent(supabase=sb, now_fn=_fixed_now)


# ── Tests ───────────────────────────────────────────────────────────────


class PurchaseProofAgentTests(unittest.TestCase):

    def _run(self, coro):
        return asyncio.run(coro)

    # 1) Happy path — manual fields → approved --------------------------

    def test_manual_fields_approved(self):
        sb = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }))
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.data["decision"], "approved")
        self.assertEqual(result.reason, "strong_match")
        self.assertGreaterEqual(result.confidence, APPROVE_THRESHOLD)
        self.assertEqual(result.data["merchant_match_strength"], 1.0)
        self.assertEqual(result.data["parsed_amount"], 25.00)
        self.assertEqual(result.data["parsed_date"], "2026-04-07")
        self.assertEqual(result.data["business_name"], "Tony's Pizza")
        self.assertTrue(result.data["dedup_hash"])

    # 2) receipt_text parse path ---------------------------------------

    def test_receipt_text_extracts_amount_and_date(self):
        sb = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 0,  # no manual amount
            "receipt_text": (
                "Tony's Pizza\n"
                "123 Main St, Newark\n"
                "Large Pizza\n"
                "Total: $18.50\n"
                "Date: 2026-04-05\n"
            ),
        }))
        self.assertIn(result.status, ("ok", "review"))
        self.assertEqual(result.data["parsed_amount"], 18.50)
        self.assertEqual(result.data["parsed_date"], "2026-04-05")
        self.assertEqual(result.data["decision"], "approved")
        self.assertGreaterEqual(result.confidence, APPROVE_THRESHOLD)

    # 3) Dedup hit ------------------------------------------------------

    def test_dedup_hit_returns_duplicate_receipt(self):
        sb = _FakeSupabase(
            businesses=[{"id": "biz1", "name": "Tony's Pizza"}],
            duplicates=[{"id": "existing-proof"}],
        )
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "duplicate_receipt")
        self.assertEqual(result.data["decision"], "rejected")

    # 4) Velocity cap ---------------------------------------------------

    def test_velocity_cap_flags_for_review(self):
        sb = _FakeSupabase(
            businesses=[{"id": "biz1", "name": "Tony's Pizza"}],
            duplicates=[],
            velocity_rows=[{"id": f"p{i}"} for i in range(VELOCITY_MAX)],
        )
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }))
        self.assertEqual(result.status, "review")
        self.assertEqual(result.reason, "velocity_limit")
        self.assertEqual(result.data["decision"], "review")

    # 5) Image only → review with deterministic reason -----------------

    def test_image_only_returns_review_with_image_parse_unavailable(self):
        sb = _FakeSupabase()
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "",
            "receipt_image_url": "https://example.com/receipt.jpg",
            "purchase_amount_usd": 0,
        }))
        self.assertEqual(result.status, "review")
        self.assertEqual(result.reason, "image_parse_unavailable")
        self.assertEqual(result.data["decision"], "review")

    # 6) Empty submission → rejected -----------------------------------

    def test_empty_submission_is_rejected(self):
        sb = _FakeSupabase()
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "",
            "purchase_amount_usd": 0,
            "receipt_text": "",
            "receipt_image_url": "",
            "merchant_name": "",
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "empty_submission")
        self.assertEqual(result.data["decision"], "rejected")

    # 7) Weak ambiguous merchant → review ------------------------------

    def test_ambiguous_merchant_from_text_goes_to_review(self):
        """
        A receipt_text with a weak merchant candidate that does not match
        the claimed business should score between REVIEW and APPROVE
        thresholds and land in review, not auto-approve.
        """
        sb = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 0,  # no manual trust signal
            "receipt_text": (
                "Generic Snacks Corp\n"
                "Total 12.00\n"
            ),
        }))
        self.assertEqual(result.status, "review")
        self.assertEqual(result.data["decision"], "review")
        self.assertLess(result.confidence, APPROVE_THRESHOLD)
        # Merchant strength is weak but not zero — Jaccard penalty applies
        self.assertLess(result.data["merchant_match_strength"], 0.5)

    # 8) Business not found --------------------------------------------

    def test_business_not_found_is_rejected(self):
        sb = _FakeSupabase(businesses=[])  # empty lookup
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "does-not-exist",
            "purchase_amount_usd": 25.00,
            "merchant_name": "Whatever",
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "business_not_found")

    # 9) Determinism ----------------------------------------------------

    def test_confidence_is_deterministic_across_runs(self):
        def _fresh_sb():
            return _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        payload = {
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }
        r1 = self._run(_agent(_fresh_sb()).run(payload))
        r2 = self._run(_agent(_fresh_sb()).run(payload))
        r3 = self._run(_agent(_fresh_sb()).run(payload))
        self.assertEqual(r1.confidence, r2.confidence)
        self.assertEqual(r2.confidence, r3.confidence)
        self.assertEqual(r1.data["dedup_hash"], r2.data["dedup_hash"])

    # 10) Suspicious-amount penalty -------------------------------------

    def test_suspicious_amount_penalty_reduces_confidence(self):
        sb_normal = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        sb_huge = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        normal = self._run(_agent(sb_normal).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }))
        huge = self._run(_agent(sb_huge).run({
            "buyer_privy_id": "user2",  # different buyer to avoid shared dedup
            "external_business_id": "biz1",
            "purchase_amount_usd": 5000.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }))
        self.assertLess(huge.confidence, normal.confidence)

    # 11) Confidence stays bounded 0..1 --------------------------------

    def test_confidence_bounded(self):
        sb = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
            "receipt_text": "Tony's Pizza receipt text padded out to reach the length bonus threshold now.",
        }))
        self.assertGreaterEqual(result.confidence, 0.0)
        self.assertLessEqual(result.confidence, 1.0)

    # 12) Stale receipt (older than MAX_RECEIPT_AGE_DAYS) --------------

    def test_stale_receipt_penalised(self):
        sb = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        stale = self._run(_agent(sb).run({
            "buyer_privy_id": "user-stale",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2025-01-01",   # > 60 days old vs fixed now=2026-04-08
            "merchant_name": "Tony's Pizza",
        }))
        # Penalty is applied — merchant match alone keeps it in review range
        self.assertEqual(stale.status, "review")
        self.assertLess(stale.confidence, APPROVE_THRESHOLD)

    # 13) Logs drained ---------------------------------------------------

    def test_logs_drained_into_result(self):
        sb = _FakeSupabase(businesses=[{"id": "biz1", "name": "Tony's Pizza"}])
        result = self._run(_agent(sb).run({
            "buyer_privy_id": "user1",
            "external_business_id": "biz1",
            "purchase_amount_usd": 25.00,
            "purchase_date": "2026-04-07",
            "merchant_name": "Tony's Pizza",
        }))
        self.assertTrue(any("purchase_proof" in line for line in result.logs))


if __name__ == "__main__":
    unittest.main()
