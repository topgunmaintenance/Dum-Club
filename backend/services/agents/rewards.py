"""
Rewards Agent — Agent 3 of the Off-Platform → On-Platform Growth Engine.

Responsibility
    Given a verified off-platform purchase proof, deterministically:
        - detect idempotent replay and return a clean no-op success
        - compute the reward tier (base + first-visit + lead-credit)
        - enforce per-proof and per-user daily caps
        - reject future-dated proofs
        - on commit: write the ledger row(s), log the verified demand
          event, and persist the campaign type back onto the proof

Explicit separate concepts
    This agent MUST distinguish two things everywhere in code and logs:

        business_first_verified_purchase
            "Is this the very first verified purchase at this
             external_business_id by ANYONE?" — true when no prior
            external_business_demand_events row with
            demand_type='verified_purchase' exists for the business.
            Triggers LEAD_CREDIT_BONUS_DUM paid to the buyer who
            bootstrapped the business into the ecosystem.

        buyer_first_visit_to_business
            "Is this the first verified purchase by THIS buyer at this
             business?" — true when no prior verified_purchase demand
            event exists for (external_business_id, buyer_privy_id).
            Triggers FIRST_VISIT_BONUS_DUM paid to the buyer for
            discovering the business for themselves.

    These are independent. They can both be true, only one, or neither.
    A single proof may trigger both bonuses. When business_first is
    true, buyer_first is also true by definition (you cannot have been
    here before if nobody has), but the two are scored separately so
    future tuning can split them.

Idempotency
    The canonical key is dum_transactions.reference_id. Before any write
    the agent does ONE read against dum_transactions filtered by
    reference_id IN ("proof:<id>", "proof:<id>:ref"). If either key
    exists, the agent returns a clean no-op success with
    data.idempotent_replay = True and data.points_awarded = 0. This is
    not a reject — it is a successful replay.

Dry-run
    Pass commit=False to get the same tier calculation without any
    database writes. Used by PurchaseProofAgent for potential_reward
    previews and by any future admin preview tool.

Deterministic
    No LLM, no OCR, no embeddings, no network calls. All database
    access goes through the constructor-injected supabase client so
    tests run fully offline.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from services.agents.base import AgentResult, BaseAgent


# ── Reward tier constants ──────────────────────────────────────────────
#
# Single source of truth for off-platform reward math. Change these
# here, not in route code. Every constant has an explicit comment so a
# future tuning PR never has to guess what they mean.

# Every verified off-platform proof earns this. The floor.
BASE_REWARD_DUM = 10

# A repeat visit (the buyer has a prior verified purchase at this same
# business) earns the base and nothing more. This constant exists as an
# explicit future tuning point; today it is identical to BASE_REWARD_DUM.
REPEAT_VISIT_REWARD_DUM = BASE_REWARD_DUM

# Added on top of the base when buyer_first_visit_to_business is True.
# Rewards the buyer for discovering this business for themselves.
FIRST_VISIT_BONUS_DUM = 5

# Added on top of the base when business_first_verified_purchase is
# True. Rewards the buyer for bootstrapping a brand-new business into
# the DUM Club ecosystem. Stacks with FIRST_VISIT_BONUS_DUM because the
# very first person is also their own first visitor.
LEAD_CREDIT_BONUS_DUM = 10

# Paid to the referring_privy_id on a separate ledger row when the
# proof's referring_privy_id is set. Independent of the buyer's own
# reward — reference_id is f"proof:<id>:ref".
REFERRAL_BONUS_DUM = 5

# Hard cap on any single proof's reward. Current tier max is
# BASE + FIRST_VISIT + LEAD_CREDIT = 25, well under the cap. The cap
# exists as a safety rail against future tuning drift.
MAX_REWARD_PER_PROOF_DUM = 50

# Hard cap on per-user 24h off-platform earnings. When a new reward
# would push the user above this threshold, the whole reward is
# denied with reason "daily_cap_exceeded". Conservative by design —
# tune upward after observing real traffic.
MAX_DAILY_OFFPLATFORM_DUM_PER_USER = 200

# Ledger reasons used in dum_transactions. Kept in sync with
# EARNED_REASONS in api/routes/dum_points.py.
REASON_BASE = "verified_off_platform_purchase"
REASON_REFERRAL = "referral_credit_off_platform"


def _ref_base(proof_id: str) -> str:
    """Canonical idempotency key for the buyer's base reward row."""
    return f"proof:{proof_id}"


def _ref_referral(proof_id: str) -> str:
    """Canonical idempotency key for the referral credit row."""
    return f"proof:{proof_id}:ref"


# ── Agent ──────────────────────────────────────────────────────────────


class RewardsAgent(BaseAgent):
    """Agent 3 — single source of truth for off-platform reward application."""

    name = "rewards"

    def __init__(
        self,
        supabase: Any,
        now_fn: Optional[Callable[[], datetime]] = None,
        balance_updater: Optional[Callable[..., int]] = None,
    ) -> None:
        """
        Args:
            supabase: Supabase client (sync). Used for idempotency lookup,
                first-visit detection, daily cap query, ledger read, demand
                event insert, and proof campaign update. Injected so tests
                run fully offline.
            now_fn: Callable returning the current datetime. Defaults to
                datetime.now(timezone.utc). Injected so tests are
                deterministic.
            balance_updater: Callable with the same signature as
                `api.routes.dum_points._update_balance_and_log`. Defaults
                to a lazy import of that module-level helper. Injected so
                tests can drop a fake in and exercise the full commit path
                without importing FastAPI routes.
        """
        super().__init__()
        self._sb = supabase
        self._now = now_fn or (lambda: datetime.now(timezone.utc))
        self._balance_updater = balance_updater

    def _update_balance_and_log(
        self,
        privy_id: str,
        delta: int,
        reason: str,
        reference_id: str,
        business_candidate_id: str,
    ) -> int:
        """
        Dispatch to the injected balance updater, falling back to the
        canonical `_update_balance_and_log` helper in the dum_points route
        module when no override is supplied. The lazy import keeps the
        services layer free of a hard dependency on the routes layer.
        """
        if self._balance_updater is not None:
            return int(self._balance_updater(
                self._sb,
                privy_id,
                delta,
                reason,
                reference_id,
                business_candidate_id=business_candidate_id,
            ))
        from api.routes.dum_points import _update_balance_and_log
        return int(_update_balance_and_log(
            self._sb,
            privy_id,
            delta,
            reason,
            reference_id,
            business_candidate_id=business_candidate_id,
        ))

    # ── Public API ────────────────────────────────────────────────────

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        proof_id: str = (payload.get("proof_id") or "").strip()
        buyer_privy_id: str = (payload.get("buyer_privy_id") or "").strip()
        external_business_id: str = (payload.get("external_business_id") or "").strip()
        amount_usd: float = float(payload.get("amount_usd") or 0)
        purchase_date_raw: str = (payload.get("purchase_date") or "").strip()
        referring_privy_id: str = (payload.get("referring_privy_id") or "").strip()
        commit: bool = bool(payload.get("commit", True))

        # ── 1) Required-field validation ──────────────────────────────
        if not proof_id:
            return self._reject("missing_proof_id", "proof_id is required")
        if not buyer_privy_id:
            return self._reject("missing_buyer_privy_id", "buyer_privy_id is required")
        if not external_business_id:
            return self._reject(
                "missing_external_business_id",
                "external_business_id is required",
            )

        # ── 2) Future-dated proof rejection ───────────────────────────
        if purchase_date_raw:
            try:
                purchase_date = date.fromisoformat(purchase_date_raw)
            except ValueError:
                # Unparseable dates are tolerated at this layer — the
                # Purchase Proof Agent already validated format upstream.
                purchase_date = None
            if purchase_date is not None and purchase_date > self._now().date():
                return self._reject(
                    "future_dated_proof",
                    f"purchase_date {purchase_date.isoformat()} is in the future",
                )

        # ── 3) Idempotency check ──────────────────────────────────────
        # One read covering BOTH the base and referral keys. If either
        # row exists, this is a replay — return a clean no-op success.
        existing_rows = self._lookup_existing_reward_rows(proof_id)
        if existing_rows:
            current_balance = self._read_balance(buyer_privy_id)
            self.log(
                f"idempotent replay proof={proof_id} buyer={buyer_privy_id} "
                f"existing_rows={len(existing_rows)}"
            )
            return AgentResult(
                status="ok",
                data={
                    "idempotent_replay": True,
                    "committed": False,
                    "points_awarded": 0,
                    "referral_credit": 0,
                    "business_first_verified_purchase": False,
                    "buyer_first_visit_to_business": False,
                    "campaign_type": "idempotent_replay",
                    "new_balance": current_balance,
                    "business_candidate_id": external_business_id,
                    "reference_id_base": _ref_base(proof_id),
                    "reference_id_referral": _ref_referral(proof_id),
                    "reason": "idempotent_replay",
                },
                confidence=1.0,
                reason="idempotent_replay",
                logs=self._drain_logs(),
            )

        # ── 4) First-visit detection (EXPLICIT separate concepts) ─────
        business_first_verified_purchase = self._is_business_first_verified_purchase(
            external_business_id
        )
        buyer_first_visit_to_business = self._is_buyer_first_visit_to_business(
            external_business_id, buyer_privy_id
        )

        # ── 5) Reward calculation ─────────────────────────────────────
        if buyer_first_visit_to_business:
            base = BASE_REWARD_DUM
            first_visit_bonus = FIRST_VISIT_BONUS_DUM
        else:
            # Repeat visitor — no buyer-first bonus.
            base = REPEAT_VISIT_REWARD_DUM
            first_visit_bonus = 0
        lead_credit = LEAD_CREDIT_BONUS_DUM if business_first_verified_purchase else 0
        referral_credit = REFERRAL_BONUS_DUM if referring_privy_id else 0

        subtotal = base + first_visit_bonus + lead_credit
        points_awarded = min(subtotal, MAX_REWARD_PER_PROOF_DUM)
        capped_at_max_per_proof = subtotal > MAX_REWARD_PER_PROOF_DUM

        # Determine the primary campaign type. Lead credit wins over
        # first visit because it is rarer and more meaningful for
        # attribution analytics.
        if business_first_verified_purchase:
            campaign_type = "lead_credit"
        elif buyer_first_visit_to_business:
            campaign_type = "first_visit"
        else:
            campaign_type = "repeat_visit"

        # ── 6) Daily cap check ────────────────────────────────────────
        current_24h = self._sum_off_platform_24h(buyer_privy_id)
        if current_24h + points_awarded > MAX_DAILY_OFFPLATFORM_DUM_PER_USER:
            self.log(
                f"daily cap hit proof={proof_id} buyer={buyer_privy_id} "
                f"current_24h={current_24h} would_add={points_awarded} "
                f"cap={MAX_DAILY_OFFPLATFORM_DUM_PER_USER}"
            )
            return AgentResult(
                status="reject",
                data={
                    "reason": "daily_cap_exceeded",
                    "points_would_be": points_awarded,
                    "current_24h": current_24h,
                    "daily_cap": MAX_DAILY_OFFPLATFORM_DUM_PER_USER,
                    "business_first_verified_purchase": business_first_verified_purchase,
                    "buyer_first_visit_to_business": buyer_first_visit_to_business,
                    "campaign_type": campaign_type,
                },
                confidence=0.0,
                reason="daily_cap_exceeded",
                logs=self._drain_logs(),
            )

        self.log(
            f"reward computed proof={proof_id} buyer={buyer_privy_id} "
            f"biz={external_business_id} "
            f"business_first_verified_purchase={business_first_verified_purchase} "
            f"buyer_first_visit_to_business={buyer_first_visit_to_business} "
            f"campaign={campaign_type} points={points_awarded} "
            f"referral={referral_credit} commit={commit}"
        )

        # ── 7) Dry run ────────────────────────────────────────────────
        if not commit:
            current_balance = self._read_balance(buyer_privy_id)
            return AgentResult(
                status="ok",
                data={
                    "idempotent_replay": False,
                    "committed": False,
                    "points_awarded": points_awarded,
                    "referral_credit": referral_credit,
                    "business_first_verified_purchase": business_first_verified_purchase,
                    "buyer_first_visit_to_business": buyer_first_visit_to_business,
                    "campaign_type": campaign_type,
                    "new_balance": current_balance + points_awarded,
                    "business_candidate_id": external_business_id,
                    "reference_id_base": _ref_base(proof_id),
                    "reference_id_referral": _ref_referral(proof_id) if referring_privy_id else "",
                    "capped_at_max_per_proof": capped_at_max_per_proof,
                    "reason": "dry_run",
                },
                confidence=1.0,
                reason="dry_run",
                logs=self._drain_logs(),
            )

        # ── 8) Commit: buyer's base reward ────────────────────────────
        new_balance = 0
        try:
            new_balance = self._update_balance_and_log(
                buyer_privy_id,
                points_awarded,
                REASON_BASE,
                _ref_base(proof_id),
                external_business_id,
            )
        except Exception as exc:
            # Loud, tagged — we never silently drop a reward.
            self.log(
                f"BASE REWARD FAILED proof={proof_id} buyer={buyer_privy_id} "
                f"amount={points_awarded} err={type(exc).__name__}: {exc!r}"
            )
            return AgentResult(
                status="error",
                data={
                    "reason": "base_reward_write_failed",
                    "points_awarded": 0,
                    "referral_credit": 0,
                    "business_first_verified_purchase": business_first_verified_purchase,
                    "buyer_first_visit_to_business": buyer_first_visit_to_business,
                    "campaign_type": campaign_type,
                    "error": f"{type(exc).__name__}: {exc}",
                },
                confidence=0.0,
                reason="base_reward_write_failed",
                logs=self._drain_logs(),
            )

        # ── 9) Commit: referral credit (separate ledger row) ──────────
        referral_awarded = 0
        if referral_credit > 0 and referring_privy_id:
            try:
                self._update_balance_and_log(
                    referring_privy_id,
                    referral_credit,
                    REASON_REFERRAL,
                    _ref_referral(proof_id),
                    external_business_id,
                )
                referral_awarded = referral_credit
            except Exception as exc:
                # Non-fatal — the buyer's base reward already landed.
                # Logged loudly so a referral-credit backfill job can
                # reconcile from logs if needed.
                self.log(
                    f"REFERRAL CREDIT FAILED proof={proof_id} "
                    f"ref_privy_id={referring_privy_id} amount={referral_credit} "
                    f"err={type(exc).__name__}: {exc!r}"
                )

        # ── 10) Commit: verified demand event ─────────────────────────
        # Written AFTER the first-visit checks so the checks reflect
        # state before THIS proof. Non-fatal if it fails.
        try:
            self._sb.table("external_business_demand_events").insert({
                "external_business_id": external_business_id,
                "buyer_privy_id": buyer_privy_id,
                "demand_type": "verified_purchase",
                "purchase_amount_usd": amount_usd,
            }).execute()
        except Exception as exc:
            self.log(
                f"demand event insert FAILED proof={proof_id} "
                f"biz={external_business_id} err={type(exc).__name__}: {exc!r}"
            )

        # ── 11) Commit: persist campaign_type on the proof row ────────
        try:
            update: dict[str, Any] = {"campaign_type": campaign_type}
            if referring_privy_id:
                update["referring_privy_id"] = referring_privy_id
            self._sb.table("purchase_proofs").update(update).eq("id", proof_id).execute()
        except Exception as exc:
            # Non-fatal — attribution is persisted in dum_transactions too.
            self.log(
                f"campaign_type persist FAILED proof={proof_id} "
                f"err={type(exc).__name__}: {exc!r}"
            )

        # ── 12) Return committed result ───────────────────────────────
        return AgentResult(
            status="ok",
            data={
                "idempotent_replay": False,
                "committed": True,
                "points_awarded": points_awarded,
                "referral_credit": referral_awarded,
                "business_first_verified_purchase": business_first_verified_purchase,
                "buyer_first_visit_to_business": buyer_first_visit_to_business,
                "campaign_type": campaign_type,
                "new_balance": new_balance,
                "business_candidate_id": external_business_id,
                "reference_id_base": _ref_base(proof_id),
                "reference_id_referral": _ref_referral(proof_id) if referring_privy_id else "",
                "capped_at_max_per_proof": capped_at_max_per_proof,
                "reason": "committed",
            },
            confidence=1.0,
            reason="committed",
            logs=self._drain_logs(),
        )

    # ── Internal helpers ──────────────────────────────────────────────

    def _reject(self, reason: str, message: str) -> AgentResult:
        self.log(f"reject reason={reason} msg={message}")
        return AgentResult(
            status="reject",
            data={"reason": reason, "message": message},
            confidence=0.0,
            reason=reason,
            logs=self._drain_logs(),
        )

    def _lookup_existing_reward_rows(self, proof_id: str) -> list[dict]:
        """
        One read covering both the base and referral idempotency keys.
        Returns the list of matching rows (possibly empty). Never raises.
        """
        keys = [_ref_base(proof_id), _ref_referral(proof_id)]
        try:
            res = (
                self._sb.table("dum_transactions")
                .select("id, reference_id, amount, privy_id")
                .in_("reference_id", keys)
                .limit(5)
                .execute()
            )
            return res.data or []
        except Exception as exc:
            self.log(
                f"idempotency lookup error proof={proof_id} "
                f"err={type(exc).__name__}: {exc!r}"
            )
            return []

    def _is_business_first_verified_purchase(self, external_business_id: str) -> bool:
        """
        True when no prior verified_purchase demand event exists for
        this external_business_id (by any buyer). Checked BEFORE the
        current proof's demand event is written, so the check reflects
        the state at call time.
        """
        try:
            res = (
                self._sb.table("external_business_demand_events")
                .select("id")
                .eq("external_business_id", external_business_id)
                .eq("demand_type", "verified_purchase")
                .limit(1)
                .execute()
            )
            return len(res.data or []) == 0
        except Exception as exc:
            # Safe default — assume NOT first so we never accidentally
            # mint a lead credit we can't justify.
            self.log(
                f"business_first_verified_purchase lookup error "
                f"biz={external_business_id} err={type(exc).__name__}: {exc!r}"
            )
            return False

    def _is_buyer_first_visit_to_business(
        self,
        external_business_id: str,
        buyer_privy_id: str,
    ) -> bool:
        """
        True when THIS buyer has no prior verified_purchase demand event
        at THIS business. Independent of business_first_verified_purchase.
        """
        try:
            res = (
                self._sb.table("external_business_demand_events")
                .select("id")
                .eq("external_business_id", external_business_id)
                .eq("buyer_privy_id", buyer_privy_id)
                .eq("demand_type", "verified_purchase")
                .limit(1)
                .execute()
            )
            return len(res.data or []) == 0
        except Exception as exc:
            # Safe default — assume NOT first so we never accidentally
            # mint a first-visit bonus we can't justify.
            self.log(
                f"buyer_first_visit_to_business lookup error "
                f"biz={external_business_id} buyer={buyer_privy_id} "
                f"err={type(exc).__name__}: {exc!r}"
            )
            return False

    def _sum_off_platform_24h(self, buyer_privy_id: str) -> int:
        """
        Sum of DUM awarded to this buyer from verified off-platform
        purchases in the last 24 hours. Used by the daily cap check.
        """
        cutoff = (self._now() - timedelta(hours=24)).isoformat()
        try:
            res = (
                self._sb.table("dum_transactions")
                .select("amount")
                .eq("privy_id", buyer_privy_id)
                .eq("reason", REASON_BASE)
                .gte("created_at", cutoff)
                .execute()
            )
            return sum(int(row.get("amount") or 0) for row in (res.data or []))
        except Exception as exc:
            # Safe default — 0. Loud log so ops can notice.
            self.log(
                f"daily cap query error buyer={buyer_privy_id} "
                f"err={type(exc).__name__}: {exc!r}"
            )
            return 0

    def _read_balance(self, privy_id: str) -> int:
        """Read a user's current dum_balance. Returns 0 on any failure."""
        try:
            res = (
                self._sb.table("users")
                .select("dum_balance")
                .eq("privy_id", privy_id)
                .limit(1)
                .execute()
            )
            if res.data:
                return int(res.data[0].get("dum_balance") or 0)
        except Exception as exc:
            self.log(
                f"balance read error privy_id={privy_id} "
                f"err={type(exc).__name__}: {exc!r}"
            )
        return 0
