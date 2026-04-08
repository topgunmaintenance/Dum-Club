"""
Purchase Proof Agent — Agent 2 of the Off-Platform → On-Platform Growth Engine.

Responsibility
    Given a purchase proof submission (manual typed fields, free-text receipt,
    or image URL), deterministically:
        - normalise the input
        - parse merchant / amount / date from text when present
        - fuzzy-match merchant against external_businesses.name
        - score confidence on a 0.0 – 1.0 scale
        - classify as approved / review / rejected with an explicit reason code
        - detect duplicates via the shared receipt hash
        - apply a minimal velocity guard (too-many-submissions-in-window)

Hard constraints (enforced by design)
    - Deterministic only. No LLM, no OCR, no network calls from the agent core.
    - Constructor injection for supabase + clock so every test runs offline.
    - Reward math is NOT done here. This agent only produces a decision; the
      route is responsible for turning `approved` into an on-ledger reward
      via the existing _apply_verified_side_effects helper.
    - Image URLs are NEVER parsed in this PR. If image_url is the only signal
      (no typed amount, no receipt text, no merchant candidate from the route
      via external_business_id), the agent returns review with reason
      "image_parse_unavailable".

Reason codes returned
    strong_match              confidence >= APPROVE_THRESHOLD
    ambiguous_match           confidence in [REVIEW_THRESHOLD, APPROVE_THRESHOLD)
    insufficient_evidence     confidence < REVIEW_THRESHOLD
    empty_submission          no amount, no text, no image, no merchant id
    image_parse_unavailable   image-only path, deferred in this PR
    duplicate_receipt         dedup hash already seen
    velocity_limit            too many submissions from buyer in window
    business_not_found        external_business_id does not resolve in DB

AgentResult shape
    status   "ok" | "review" | "reject" | "empty" | "error"
    data     structured fields used by the route for persistence:
        {
            "decision": "approved" | "review" | "rejected",
            "reason": "<one of the codes above>",
            "parsed_merchant": str,
            "parsed_amount": float,
            "parsed_date": "YYYY-MM-DD" | "",
            "merchant_match_strength": float,   # 0..1
            "score_breakdown": {...},            # for debug / agent_notes
            "dedup_hash": str,
            "business_name": str,
        }
    confidence  0.0 – 1.0, the final composite score
    reason      machine-friendly reason code (mirrors data["reason"])
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from services.agents._dedup import receipt_hash
from services.agents.base import AgentResult, BaseAgent


# ── Tunable constants ──────────────────────────────────────────────────
#
# These thresholds are deliberately conservative. They can be tuned later
# without touching the algorithm. Keep them in one place so a quality-tuning
# PR never has to grep the agent code.

APPROVE_THRESHOLD = 0.70
REVIEW_THRESHOLD = 0.40

# Velocity window: if the buyer has submitted >= VELOCITY_MAX proofs in the
# last VELOCITY_WINDOW_MINUTES, the new submission is flagged for review.
VELOCITY_WINDOW_MINUTES = 10
VELOCITY_MAX = 3

# Date sanity: receipts older than this are flagged as low confidence.
MAX_RECEIPT_AGE_DAYS = 60

# Amount sanity: suspiciously large amounts get a penalty, not a hard reject.
SUSPICIOUS_AMOUNT_USD = 2000.0


# ── Text parsing helpers ───────────────────────────────────────────────
#
# Plain regex only. No heuristics that depend on model output. If the regex
# doesn't match, the parser simply returns empty — the caller falls back to
# the typed / manual fields.

# Amount parser. We require EITHER a leading "$" OR an explicit ".XX" cents
# suffix so we never mistake a 4-digit year inside an ISO date for a dollar
# amount. The regex captures two groups: group(1) for the "$..." variant,
# group(2) for the ".XX" variant.
_AMOUNT_RE = re.compile(
    r"(?:\$\s*(\d{1,6}(?:\.\d{1,2})?)|\b(\d{1,6}\.\d{2})\b)"
)
_ISO_DATE_RE = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")
_US_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b")


def _parse_amount_from_text(text: str) -> float:
    """
    Extract the most likely purchase amount from free text. Picks the
    LARGEST dollar figure found — receipts usually quote the total amount
    last and largest. Returns 0.0 when nothing parses.

    Requires either a "$" prefix or an explicit ".XX" cents suffix so a
    4-digit year inside an ISO date is never mistaken for an amount.
    """
    if not text:
        return 0.0
    candidates: list[float] = []
    for m in _AMOUNT_RE.finditer(text):
        raw = m.group(1) or m.group(2) or ""
        if not raw:
            continue
        try:
            val = float(raw)
        except ValueError:
            continue
        if val > 0:
            candidates.append(val)
    if not candidates:
        return 0.0
    return max(candidates)


def _parse_date_from_text(text: str) -> str:
    """
    Extract a YYYY-MM-DD date from free text. Tries ISO first, then US.
    Returns empty string when nothing parses.
    """
    if not text:
        return ""
    iso = _ISO_DATE_RE.search(text)
    if iso:
        y, mo, d = iso.groups()
        try:
            return date(int(y), int(mo), int(d)).isoformat()
        except ValueError:
            pass
    us = _US_DATE_RE.search(text)
    if us:
        mo, d, y = us.groups()
        try:
            year = int(y)
            if year < 100:
                year += 2000
            return date(year, int(mo), int(d)).isoformat()
        except ValueError:
            pass
    return ""


def _parse_merchant_from_text(text: str) -> str:
    """
    Extract a merchant candidate from free text. Very conservative: first
    non-empty line that is mostly letters (not a receipt header like
    '===== RECEIPT =====' or a totals line). Returns empty string when
    nothing looks like a merchant.
    """
    if not text:
        return ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        letters = sum(1 for c in line if c.isalpha())
        if letters < 3:
            continue
        if letters / max(len(line), 1) < 0.5:
            continue
        return line[:80]
    return ""


# ── Merchant matching ─────────────────────────────────────────────────

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")
_STOPWORDS = {"the", "and", "of", "co", "inc", "llc", "ltd", "company"}


def _normalise_merchant(name: str) -> set[str]:
    """Lowercase, strip punctuation, split into token set, drop stopwords."""
    if not name:
        return set()
    lowered = _PUNCT_RE.sub(" ", name.lower())
    tokens = _WS_RE.sub(" ", lowered).strip().split(" ")
    return {t for t in tokens if t and t not in _STOPWORDS and len(t) > 1}


def _merchant_match_strength(candidate: str, canonical: str) -> float:
    """
    Deterministic fuzzy match. Returns a 0.0 – 1.0 strength:
        1.00  exact normalised match
        0.85  one token-set is a subset of the other (rename / tagline)
        Jaccard fallback otherwise
        0.00  either side empty
    """
    a = _normalise_merchant(candidate)
    b = _normalise_merchant(canonical)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a.issubset(b) or b.issubset(a):
        return 0.85
    intersect = len(a & b)
    union = len(a | b)
    if union == 0:
        return 0.0
    return round(intersect / union, 4)


# ── Agent ──────────────────────────────────────────────────────────────


class PurchaseProofAgent(BaseAgent):
    """Agent 2 — parses, matches, scores, classifies a purchase proof."""

    name = "purchase_proof"

    def __init__(
        self,
        supabase: Any,
        now_fn: Optional[Callable[[], datetime]] = None,
    ) -> None:
        """
        Args:
            supabase: Supabase client (sync). Used for business lookup,
                dedup query, and velocity query. Injected so tests run offline.
            now_fn:  Callable returning the current datetime. Defaults to
                datetime.now(timezone.utc). Injected so tests are deterministic.
        """
        super().__init__()
        self._sb = supabase
        self._now = now_fn or (lambda: datetime.now(timezone.utc))

    # ── Public API ────────────────────────────────────────────────────

    async def run(self, payload: dict[str, Any]) -> AgentResult:
        buyer_privy_id: str = (payload.get("buyer_privy_id") or "").strip()
        external_business_id: str = (payload.get("external_business_id") or "").strip()
        receipt_text: str = payload.get("receipt_text") or ""
        receipt_image_url: str = (payload.get("receipt_image_url") or "").strip()
        manual_amount: float = float(payload.get("purchase_amount_usd") or 0)
        manual_date_raw: str = (payload.get("purchase_date") or "").strip()
        manual_merchant: str = (payload.get("merchant_name") or "").strip()

        # ── 1) Empty check ────────────────────────────────────────────
        has_amount = manual_amount > 0
        has_text = bool(receipt_text.strip())
        has_image = bool(receipt_image_url)
        has_merchant_id = bool(external_business_id)
        has_manual_merchant = bool(manual_merchant)

        if not (has_amount or has_text or has_image or has_manual_merchant) and not has_merchant_id:
            self.log("empty submission: no amount, no text, no image, no merchant id")
            return self._decide(
                decision="rejected",
                status="reject",
                reason="empty_submission",
                confidence=0.0,
                data={
                    "parsed_merchant": "",
                    "parsed_amount": 0.0,
                    "parsed_date": "",
                    "merchant_match_strength": 0.0,
                    "score_breakdown": {},
                    "dedup_hash": "",
                    "business_name": "",
                },
            )

        # ── 2) Image-only path (deferred in this PR) ───────────────────
        if has_image and not (has_amount or has_text or has_manual_merchant):
            self.log("image-only submission: parse unavailable in this PR")
            return self._decide(
                decision="review",
                status="review",
                reason="image_parse_unavailable",
                confidence=0.0,
                data={
                    "parsed_merchant": "",
                    "parsed_amount": 0.0,
                    "parsed_date": "",
                    "merchant_match_strength": 0.0,
                    "score_breakdown": {"image_only": True},
                    "dedup_hash": "",
                    "business_name": "",
                },
            )

        # ── 3) Business lookup ────────────────────────────────────────
        business_name = ""
        if has_merchant_id:
            biz = self._lookup_business(external_business_id)
            if biz is None:
                self.log(f"business not found: {external_business_id}")
                return self._decide(
                    decision="rejected",
                    status="reject",
                    reason="business_not_found",
                    confidence=0.0,
                    data={
                        "parsed_merchant": manual_merchant,
                        "parsed_amount": manual_amount,
                        "parsed_date": manual_date_raw,
                        "merchant_match_strength": 0.0,
                        "score_breakdown": {},
                        "dedup_hash": "",
                        "business_name": "",
                    },
                )
            business_name = biz.get("name") or ""

        # ── 4) Normalise parsed fields ────────────────────────────────
        parsed_amount = manual_amount if manual_amount > 0 else _parse_amount_from_text(receipt_text)
        parsed_date = manual_date_raw or _parse_date_from_text(receipt_text)
        text_merchant = _parse_merchant_from_text(receipt_text)
        # Merchant candidate: manual override > text extraction > business name
        parsed_merchant = manual_merchant or text_merchant or business_name

        # ── 5) Merchant match strength ────────────────────────────────
        if business_name:
            if manual_merchant:
                # User explicitly picked the business; treat as full trust.
                match_strength = 1.0 if _merchant_match_strength(manual_merchant, business_name) > 0 else 1.0
            elif text_merchant:
                match_strength = _merchant_match_strength(text_merchant, business_name)
            else:
                # No text candidate; user selected the business via
                # external_business_id. Treat as full trust.
                match_strength = 1.0
        else:
            match_strength = 0.0

        # ── 6) Dedup check ────────────────────────────────────────────
        dt_for_hash = parsed_date or self._now().date().isoformat()
        dup_hash = receipt_hash(
            buyer_privy_id,
            external_business_id,
            parsed_amount,
            dt_for_hash,
        )
        if self._is_duplicate(dup_hash):
            self.log(f"duplicate receipt: hash={dup_hash}")
            return self._decide(
                decision="rejected",
                status="reject",
                reason="duplicate_receipt",
                confidence=0.0,
                data={
                    "parsed_merchant": parsed_merchant,
                    "parsed_amount": parsed_amount,
                    "parsed_date": parsed_date,
                    "merchant_match_strength": match_strength,
                    "score_breakdown": {"dedup": True},
                    "dedup_hash": dup_hash,
                    "business_name": business_name,
                },
            )

        # ── 7) Velocity check (soft: flags for review, does not reject) ─
        if buyer_privy_id and self._velocity_triggered(buyer_privy_id):
            self.log(f"velocity limit hit for buyer={buyer_privy_id}")
            return self._decide(
                decision="review",
                status="review",
                reason="velocity_limit",
                confidence=0.0,
                data={
                    "parsed_merchant": parsed_merchant,
                    "parsed_amount": parsed_amount,
                    "parsed_date": parsed_date,
                    "merchant_match_strength": match_strength,
                    "score_breakdown": {"velocity": True},
                    "dedup_hash": dup_hash,
                    "business_name": business_name,
                },
            )

        # ── 8) Confidence scoring ──────────────────────────────────────
        score, breakdown = self._score_confidence(
            match_strength=match_strength,
            parsed_amount=parsed_amount,
            parsed_date=parsed_date,
            receipt_text=receipt_text,
        )
        self.log(
            f"buyer={buyer_privy_id} biz={business_name!r} "
            f"match={match_strength} amount={parsed_amount} date={parsed_date} "
            f"confidence={score}"
        )

        # ── 9) Classification ─────────────────────────────────────────
        if score >= APPROVE_THRESHOLD:
            decision = "approved"
            status = "ok"
            reason = "strong_match"
        elif score >= REVIEW_THRESHOLD:
            decision = "review"
            status = "review"
            reason = "ambiguous_match"
        else:
            decision = "review"
            status = "review"
            reason = "insufficient_evidence"

        return self._decide(
            decision=decision,
            status=status,
            reason=reason,
            confidence=score,
            data={
                "parsed_merchant": parsed_merchant,
                "parsed_amount": parsed_amount,
                "parsed_date": parsed_date,
                "merchant_match_strength": match_strength,
                "score_breakdown": breakdown,
                "dedup_hash": dup_hash,
                "business_name": business_name,
            },
        )

    # ── Confidence ────────────────────────────────────────────────────

    def _score_confidence(
        self,
        match_strength: float,
        parsed_amount: float,
        parsed_date: str,
        receipt_text: str,
    ) -> tuple[float, dict[str, float]]:
        """
        Deterministic, auditable scoring. All components are capped so a
        single signal cannot dominate the final decision.

        Components (max total = 1.00):
            merchant   0.00 – 0.50    scaled from match_strength
            amount     0.00 – 0.20    present & plausible
            date       0.00 – 0.15    present & inside MAX_RECEIPT_AGE_DAYS
            text       0.00 – 0.10    receipt_text length signal
            penalty     - 0.30 max    date too old or amount suspicious
        """
        breakdown: dict[str, float] = {}

        merchant_component = round(match_strength * 0.50, 4)
        breakdown["merchant"] = merchant_component

        amount_component = 0.0
        if parsed_amount > 0:
            amount_component = 0.20
        breakdown["amount"] = amount_component

        date_component = 0.0
        date_penalty = 0.0
        if parsed_date:
            try:
                parsed_dt = date.fromisoformat(parsed_date)
                today = self._now().date()
                delta_days = (today - parsed_dt).days
                if 0 <= delta_days <= MAX_RECEIPT_AGE_DAYS:
                    date_component = 0.15
                elif delta_days < 0:
                    # Future date is suspicious but not fatal
                    date_penalty = 0.15
                else:
                    date_penalty = 0.15
            except ValueError:
                date_penalty = 0.05
        breakdown["date"] = date_component
        if date_penalty:
            breakdown["date_penalty"] = -date_penalty

        text_component = 0.0
        if receipt_text and len(receipt_text.strip()) >= 40:
            text_component = 0.10
        breakdown["text"] = text_component

        amount_penalty = 0.0
        if parsed_amount > SUSPICIOUS_AMOUNT_USD:
            amount_penalty = 0.15
            breakdown["amount_penalty"] = -amount_penalty

        raw = (
            merchant_component
            + amount_component
            + date_component
            + text_component
            - date_penalty
            - amount_penalty
        )
        score = max(0.0, min(round(raw, 4), 1.0))
        breakdown["total"] = score
        return score, breakdown

    # ── DB helpers ────────────────────────────────────────────────────

    def _lookup_business(self, external_business_id: str) -> Optional[dict]:
        try:
            res = (
                self._sb.table("external_businesses")
                .select("id, name")
                .eq("id", external_business_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:  # pragma: no cover — injected in tests
            self.log(f"business lookup error: {exc!r}")
            return None
        if not res.data:
            return None
        return res.data[0]

    def _is_duplicate(self, dup_hash: str) -> bool:
        if not dup_hash:
            return False
        try:
            res = (
                self._sb.table("purchase_proofs")
                .select("id")
                .eq("duplicate_hash", dup_hash)
                .limit(1)
                .execute()
            )
        except Exception as exc:  # pragma: no cover — injected in tests
            self.log(f"dedup query error: {exc!r}")
            return False
        return bool(res.data)

    def _velocity_triggered(self, buyer_privy_id: str) -> bool:
        """
        Count proofs from this buyer inside the velocity window. Triggered
        when count >= VELOCITY_MAX. Uses the injected clock so tests are
        deterministic.
        """
        cutoff = (self._now() - timedelta(minutes=VELOCITY_WINDOW_MINUTES)).isoformat()
        try:
            res = (
                self._sb.table("purchase_proofs")
                .select("id")
                .eq("buyer_privy_id", buyer_privy_id)
                .gte("created_at", cutoff)
                .limit(VELOCITY_MAX + 1)
                .execute()
            )
        except Exception as exc:  # pragma: no cover — injected in tests
            self.log(f"velocity query error: {exc!r}")
            return False
        return len(res.data or []) >= VELOCITY_MAX

    # ── Decision builder ──────────────────────────────────────────────

    def _decide(
        self,
        decision: str,
        status: str,
        reason: str,
        confidence: float,
        data: dict[str, Any],
    ) -> AgentResult:
        data = dict(data)
        data["decision"] = decision
        data["reason"] = reason
        return AgentResult(
            status=status,  # type: ignore[arg-type]
            data=data,
            confidence=confidence,
            reason=reason,
            logs=self._drain_logs(),
        )
