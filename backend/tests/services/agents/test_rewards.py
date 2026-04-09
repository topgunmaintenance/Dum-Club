"""
Tests for RewardsAgent.

Stdlib unittest only — no pytest, no new deps. Every dependency (Supabase,
clock) is injected so these tests run fully offline and deterministically.

Run from repo root:

    cd backend && python -m unittest tests.services.agents.test_rewards

Covers the scenarios required by the PR 3 prompt:
    - base reward happy path (repeat visit)
    - first visit bonus (buyer_first_visit_to_business only)
    - lead credit (business_first_verified_purchase stacks with first visit)
    - idempotent replay — clean no-op success
    - daily cap hit
    - max reward per proof cap
    - future-dated proof denied
    - commit=False dry run
    - referral credit row (with :ref reference_id)
    - reward reason / log output stability
    - flag alignment — agent logic and legacy path use the same base amount
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from services.agents.rewards import (  # noqa: E402
    BASE_REWARD_DUM,
    FIRST_VISIT_BONUS_DUM,
    LEAD_CREDIT_BONUS_DUM,
    MAX_DAILY_OFFPLATFORM_DUM_PER_USER,
    MAX_REWARD_PER_PROOF_DUM,
    REASON_BASE,
    REASON_REFERRAL,
    REFERRAL_BONUS_DUM,
    REPEAT_VISIT_REWARD_DUM,
    RewardsAgent,
    _ref_base,
    _ref_referral,
)


# ── Filter-aware fake Supabase ──────────────────────────────────────────
#
# The rewards agent makes several queries to overlapping tables with
# different filter combinations. A simple per-table canned-response fake
# isn't expressive enough — the fake below accumulates .eq()/.in_()/.gte()
# calls into a filter dict and filters the canned row list at execute()
# time. That way each test can seed a single shared dataset and the agent
# itself exercises the real query pattern.


class _FakeQuery:
    def __init__(self, rows, on_insert=None, on_update=None):
        self._rows = rows
        self._filters: dict = {}
        self._in_filters: dict = {}
        self._gte_filters: dict = {}
        self._mode = "select"
        self._payload = None
        self._on_insert = on_insert
        self._on_update = on_update

    def select(self, *a, **kw):
        self._mode = "select"
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def in_(self, col, vals):
        self._in_filters[col] = list(vals)
        return self

    def gte(self, col, threshold):
        self._gte_filters[col] = threshold
        return self

    def limit(self, _n):
        return self

    def order(self, *a, **kw):
        return self

    def _matches(self, row):
        for col, val in self._filters.items():
            if row.get(col) != val:
                return False
        for col, vals in self._in_filters.items():
            if row.get(col) not in vals:
                return False
        for col, threshold in self._gte_filters.items():
            v = row.get(col)
            if v is None or v < threshold:
                return False
        return True

    def execute(self):
        if self._mode == "select":
            return SimpleNamespace(data=[dict(r) for r in self._rows if self._matches(r)])
        if self._mode == "insert":
            if self._on_insert:
                self._on_insert(self._payload)
            return SimpleNamespace(data=[self._payload])
        if self._mode == "update":
            if self._on_update:
                self._on_update(self._filters, self._payload)
            return SimpleNamespace(data=[self._payload])
        return SimpleNamespace(data=[])


class _FakeSupabase:
    def __init__(
        self,
        users=None,
        dum_transactions=None,
        demand_events=None,
        purchase_proofs=None,
    ):
        # users is a dict keyed by privy_id -> row dict
        self.users: dict = {k: dict(v) for k, v in (users or {}).items()}
        self.dum_transactions: list = [dict(r) for r in (dum_transactions or [])]
        self.demand_events: list = [dict(r) for r in (demand_events or [])]
        self.purchase_proofs: list = [dict(r) for r in (purchase_proofs or [])]

    def _user_rows(self):
        return [{"privy_id": k, **v} for k, v in self.users.items()]

    def table(self, name):
        if name == "users":
            return _FakeQuery(
                self._user_rows(),
                on_update=self._update_user,
            )
        if name == "dum_transactions":
            return _FakeQuery(
                self.dum_transactions,
                on_insert=lambda payload: self.dum_transactions.append(dict(payload)),
            )
        if name == "external_business_demand_events":
            return _FakeQuery(
                self.demand_events,
                on_insert=lambda payload: self.demand_events.append(dict(payload)),
            )
        if name == "purchase_proofs":
            return _FakeQuery(
                self.purchase_proofs,
                on_update=self._update_proof,
            )
        return _FakeQuery([])

    def _update_user(self, filters, payload):
        privy_id = filters.get("privy_id")
        if privy_id in self.users:
            self.users[privy_id].update(payload)

    def _update_proof(self, filters, payload):
        proof_id = filters.get("id")
        for p in self.purchase_proofs:
            if p.get("id") == proof_id:
                p.update(payload)


def _fixed_now():
    return datetime(2026, 4, 10, 12, 0, 0, tzinfo=timezone.utc)


def _fake_balance_updater(
    supabase,
    privy_id,
    delta,
    reason,
    reference_id=None,
    *,
    business_candidate_id=None,
):
    """
    Byte-equivalent of api.routes.dum_points._update_balance_and_log for
    the _FakeSupabase above. The agent is constructor-injected with this
    so tests don't need FastAPI imports.
    """
    if privy_id not in supabase.users:
        raise RuntimeError(f"user not found: {privy_id}")
    current = supabase.users[privy_id].get("dum_balance", 0) or 0
    new_balance = max(current + delta, 0)
    supabase.users[privy_id]["dum_balance"] = new_balance
    row = {
        "privy_id": privy_id,
        "amount": delta,
        "reason": reason,
        "reference_id": reference_id,
        "balance_after": new_balance,
        "created_at": _fixed_now().isoformat(),
    }
    if business_candidate_id:
        row["business_candidate_id"] = business_candidate_id
    supabase.dum_transactions.append(row)
    return new_balance


def _agent(sb):
    return RewardsAgent(
        supabase=sb,
        now_fn=_fixed_now,
        balance_updater=_fake_balance_updater,
    )


def _run(coro):
    return asyncio.run(coro)


def _make_sb(
    users=None,
    dum_transactions=None,
    demand_events=None,
    purchase_proofs=None,
):
    return _FakeSupabase(
        users=users or {"buyer1": {"dum_balance": 100}},
        dum_transactions=dum_transactions or [],
        demand_events=demand_events or [],
        purchase_proofs=purchase_proofs or [{"id": "proof_42", "status": "verified"}],
    )


# ── Tests ───────────────────────────────────────────────────────────────


class RewardsAgentTests(unittest.TestCase):

    # 1) Base reward happy path — REPEAT visit -------------------------

    def test_repeat_visit_awards_base_only(self):
        """
        Buyer has a prior verified purchase at this business (repeat
        visit) and the business has been visited before by other buyers
        too — so neither first-visit nor lead-credit fires.
        """
        sb = _make_sb(
            demand_events=[
                {
                    "external_business_id": "biz1",
                    "buyer_privy_id": "buyer1",
                    "demand_type": "verified_purchase",
                },
                {
                    "external_business_id": "biz1",
                    "buyer_privy_id": "someone_else",
                    "demand_type": "verified_purchase",
                },
            ],
        )
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
            "purchase_date": "2026-04-09",
        }))

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.reason, "committed")
        self.assertEqual(result.data["points_awarded"], REPEAT_VISIT_REWARD_DUM)
        self.assertEqual(result.data["campaign_type"], "repeat_visit")
        self.assertFalse(result.data["business_first_verified_purchase"])
        self.assertFalse(result.data["buyer_first_visit_to_business"])
        self.assertEqual(result.data["new_balance"], 100 + BASE_REWARD_DUM)

    # 2) First-visit bonus (buyer_first only, not business_first) ------

    def test_buyer_first_visit_only_awards_first_visit_bonus(self):
        """
        The business has been visited by other buyers, but THIS buyer
        has never submitted a verified purchase here before.
        """
        sb = _make_sb(
            demand_events=[
                {
                    "external_business_id": "biz1",
                    "buyer_privy_id": "someone_else",
                    "demand_type": "verified_purchase",
                },
            ],
        )
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.data["points_awarded"], BASE_REWARD_DUM + FIRST_VISIT_BONUS_DUM)
        self.assertEqual(result.data["campaign_type"], "first_visit")
        self.assertFalse(result.data["business_first_verified_purchase"])
        self.assertTrue(result.data["buyer_first_visit_to_business"])

    # 3) Lead credit — business_first stacks with buyer_first ---------

    def test_business_first_verified_purchase_stacks_with_first_visit(self):
        """
        No prior verified_purchase events exist for this business. The
        buyer is bootstrapping the business into the ecosystem — both
        lead credit AND first visit bonus apply (the very first visitor
        is definitionally also their own first visitor).
        """
        sb = _make_sb(demand_events=[])
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))

        self.assertEqual(result.status, "ok")
        self.assertEqual(
            result.data["points_awarded"],
            BASE_REWARD_DUM + FIRST_VISIT_BONUS_DUM + LEAD_CREDIT_BONUS_DUM,
        )
        self.assertEqual(result.data["campaign_type"], "lead_credit")
        self.assertTrue(result.data["business_first_verified_purchase"])
        self.assertTrue(result.data["buyer_first_visit_to_business"])

    # 4) Idempotent replay — clean no-op success -----------------------

    def test_idempotent_replay_is_clean_noop_success(self):
        """
        A dum_transactions row with reference_id='proof:proof_42'
        already exists. The second call to the agent must return a
        clean success with idempotent_replay=True and no new writes.
        """
        sb = _make_sb(
            dum_transactions=[
                {
                    "id": "existing_tx",
                    "privy_id": "buyer1",
                    "amount": 10,
                    "reason": REASON_BASE,
                    "reference_id": _ref_base("proof_42"),
                    "balance_after": 110,
                    "created_at": "2026-04-10T10:00:00+00:00",
                },
            ],
            users={"buyer1": {"dum_balance": 110}},
        )
        txn_count_before = len(sb.dum_transactions)
        demand_count_before = len(sb.demand_events)

        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))

        self.assertEqual(result.status, "ok", "replay must be a success, not a reject")
        self.assertEqual(result.reason, "idempotent_replay")
        self.assertTrue(result.data["idempotent_replay"])
        self.assertFalse(result.data["committed"])
        self.assertEqual(result.data["points_awarded"], 0)
        self.assertEqual(result.data["referral_credit"], 0)
        self.assertEqual(result.data["new_balance"], 110)
        # No new rows written — no duplicate ledger, no demand replay
        self.assertEqual(len(sb.dum_transactions), txn_count_before)
        self.assertEqual(len(sb.demand_events), demand_count_before)

    def test_idempotent_replay_matches_on_referral_row_too(self):
        """
        A row with reference_id='proof:proof_42:ref' (the referral
        key) is sufficient to trigger replay even without the base key.
        """
        sb = _make_sb(
            dum_transactions=[
                {
                    "id": "existing_ref_tx",
                    "privy_id": "referrer1",
                    "amount": REFERRAL_BONUS_DUM,
                    "reason": REASON_REFERRAL,
                    "reference_id": _ref_referral("proof_42"),
                    "balance_after": 55,
                    "created_at": "2026-04-10T10:00:00+00:00",
                },
            ],
        )
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        self.assertEqual(result.status, "ok")
        self.assertTrue(result.data["idempotent_replay"])
        self.assertEqual(result.data["points_awarded"], 0)

    # 5) Daily cap hit -------------------------------------------------

    def test_daily_cap_hit_denies_reward(self):
        """
        Buyer has 195 DUM in off-platform rewards in the last 24h. A
        new lead-credit proof (25 DUM) would push them to 220, over
        the 200 cap. Deny with explicit reason.
        """
        sb = _make_sb(
            dum_transactions=[
                {
                    "id": f"prior_{i}",
                    "privy_id": "buyer1",
                    "amount": 39,
                    "reason": REASON_BASE,
                    "reference_id": f"proof:prior_{i}",
                    "balance_after": 100 + 39 * (i + 1),
                    "created_at": "2026-04-10T11:00:00+00:00",
                }
                for i in range(5)  # 5 * 39 = 195
            ],
            demand_events=[],  # business_first_verified_purchase → lead credit
        )
        result = _run(_agent(sb).run({
            "proof_id": "proof_new",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "daily_cap_exceeded")
        self.assertEqual(result.data["current_24h"], 195)
        self.assertEqual(result.data["daily_cap"], MAX_DAILY_OFFPLATFORM_DUM_PER_USER)
        self.assertEqual(result.data["points_would_be"], BASE_REWARD_DUM + FIRST_VISIT_BONUS_DUM + LEAD_CREDIT_BONUS_DUM)

    # 6) Max reward per proof cap --------------------------------------

    def test_max_reward_per_proof_cap_is_enforced(self):
        """
        Patch the tier constants to something that would exceed the
        hard cap, then verify points_awarded is clamped to
        MAX_REWARD_PER_PROOF_DUM and capped_at_max_per_proof flag fires.
        """
        sb = _make_sb(demand_events=[])  # lead credit path
        with mock.patch("services.agents.rewards.BASE_REWARD_DUM", 40), \
             mock.patch("services.agents.rewards.FIRST_VISIT_BONUS_DUM", 20), \
             mock.patch("services.agents.rewards.LEAD_CREDIT_BONUS_DUM", 30):
            # total subtotal would be 90, cap is 50
            result = _run(_agent(sb).run({
                "proof_id": "proof_42",
                "buyer_privy_id": "buyer1",
                "external_business_id": "biz1",
                "amount_usd": 25.00,
                "commit": False,  # dry run avoids needing to handle cap in daily-cap check
            }))
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.data["points_awarded"], MAX_REWARD_PER_PROOF_DUM)
        self.assertTrue(result.data["capped_at_max_per_proof"])

    # 7) Future-dated proof denied -------------------------------------

    def test_future_dated_proof_is_rejected(self):
        """
        Purchase date is after now_fn() — reject explicitly.
        """
        sb = _make_sb(demand_events=[])
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
            "purchase_date": "2026-05-01",  # fixed_now is 2026-04-10
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "future_dated_proof")
        # Ledger untouched
        self.assertEqual(len(sb.dum_transactions), 0)

    # 8) Dry run — commit=False ----------------------------------------

    def test_dry_run_returns_calculation_without_writes(self):
        sb = _make_sb(demand_events=[])  # lead credit path
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
            "commit": False,
        }))
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.reason, "dry_run")
        self.assertFalse(result.data["committed"])
        self.assertEqual(result.data["points_awarded"], BASE_REWARD_DUM + FIRST_VISIT_BONUS_DUM + LEAD_CREDIT_BONUS_DUM)
        self.assertEqual(result.data["campaign_type"], "lead_credit")
        # Simulated new_balance = current + awarded, no real write
        self.assertEqual(result.data["new_balance"], 100 + result.data["points_awarded"])
        self.assertEqual(len(sb.dum_transactions), 0)
        self.assertEqual(len(sb.demand_events), 0)

    # 9) Referral credit row -------------------------------------------

    def test_referral_credit_writes_second_ledger_row_with_ref_key(self):
        """
        With referring_privy_id set, the agent must write TWO rows:
        one for the buyer with reference_id 'proof:<id>' and one for
        the referrer with reference_id 'proof:<id>:ref'.
        """
        sb = _make_sb(
            users={
                "buyer1": {"dum_balance": 100},
                "referrer1": {"dum_balance": 50},
            },
            demand_events=[
                {
                    "external_business_id": "biz1",
                    "buyer_privy_id": "someone_else",
                    "demand_type": "verified_purchase",
                },
            ],
        )
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
            "referring_privy_id": "referrer1",
        }))

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.data["referral_credit"], REFERRAL_BONUS_DUM)
        self.assertEqual(result.data["reference_id_referral"], _ref_referral("proof_42"))

        # Two ledger rows inserted
        self.assertEqual(len(sb.dum_transactions), 2)
        base_rows = [t for t in sb.dum_transactions if t["reference_id"] == _ref_base("proof_42")]
        ref_rows = [t for t in sb.dum_transactions if t["reference_id"] == _ref_referral("proof_42")]
        self.assertEqual(len(base_rows), 1)
        self.assertEqual(len(ref_rows), 1)
        self.assertEqual(base_rows[0]["privy_id"], "buyer1")
        self.assertEqual(base_rows[0]["reason"], REASON_BASE)
        self.assertEqual(ref_rows[0]["privy_id"], "referrer1")
        self.assertEqual(ref_rows[0]["reason"], REASON_REFERRAL)
        self.assertEqual(ref_rows[0]["amount"], REFERRAL_BONUS_DUM)

    # 10) Campaign type persistence on the proof row -------------------

    def test_campaign_type_persisted_on_proof(self):
        sb = _make_sb(demand_events=[])
        _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        proof_row = next(p for p in sb.purchase_proofs if p["id"] == "proof_42")
        self.assertEqual(proof_row["campaign_type"], "lead_credit")

    # 11) Missing required fields --------------------------------------

    def test_missing_proof_id_is_rejected(self):
        sb = _make_sb()
        result = _run(_agent(sb).run({
            "proof_id": "",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "missing_proof_id")

    def test_missing_buyer_privy_id_is_rejected(self):
        sb = _make_sb()
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "missing_buyer_privy_id")

    def test_missing_external_business_id_is_rejected(self):
        sb = _make_sb()
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "",
            "amount_usd": 25.00,
        }))
        self.assertEqual(result.status, "reject")
        self.assertEqual(result.reason, "missing_external_business_id")

    # 12) Log output stability -----------------------------------------

    def test_log_output_contains_expected_prefix(self):
        sb = _make_sb(demand_events=[])
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        self.assertTrue(any("[agent:rewards]" in line for line in result.logs))
        self.assertTrue(any("reward computed" in line for line in result.logs))

    def test_replay_log_output(self):
        sb = _make_sb(
            dum_transactions=[
                {
                    "privy_id": "buyer1",
                    "amount": 10,
                    "reason": REASON_BASE,
                    "reference_id": _ref_base("proof_42"),
                    "balance_after": 110,
                    "created_at": "2026-04-10T10:00:00+00:00",
                },
            ],
        )
        result = _run(_agent(sb).run({
            "proof_id": "proof_42",
            "buyer_privy_id": "buyer1",
            "external_business_id": "biz1",
            "amount_usd": 25.00,
        }))
        self.assertTrue(any("idempotent replay" in line for line in result.logs))

    # 13) Legacy flag-off base amount alignment ------------------------

    def test_base_reward_matches_legacy_flat_reward(self):
        """
        The legacy _calculate_reward returns a flat 10 DUM (see
        external_business.py::_FLAT_REWARD). The RewardsAgent base
        reward must match that value byte-for-byte so flipping the
        flag cannot silently change the average reward for repeat
        visitors.
        """
        # Cannot import external_business (FastAPI not available in
        # sandbox), so hard-code the known legacy constant.
        legacy_flat_reward = 10
        self.assertEqual(BASE_REWARD_DUM, legacy_flat_reward)
        self.assertEqual(REPEAT_VISIT_REWARD_DUM, legacy_flat_reward)


if __name__ == "__main__":
    unittest.main()
