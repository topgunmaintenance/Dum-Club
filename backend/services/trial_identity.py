"""
Trial-identity gate — stops the same identity from claiming the 60-day free
trial more than once across different accounts.

Stores ONLY a salted SHA-256 hash of the merchant's email in
trial_identity_ledger — never the raw email or any other PII.

Gated behind TRIAL_IDENTITY_GATE_ENABLED so production stays on today's
behavior until the DRAFT migration (080_trial_identity_ledger.sql) is applied
AND the flag is flipped. With the flag OFF, every function here is inert and
trials are granted exactly as before.

When the flag is ON the gate is FAIL-CLOSED on the trial GRANT: if the
identity can't be verified (no email / no salt) or the ledger check errors
(including the table not existing yet), the free trial is withheld rather
than silently granted. Account creation itself is never blocked by this gate.
"""
from __future__ import annotations

import hashlib
import os
from typing import Optional

# Default OFF. Flip to "true" ONLY after migration 080 is applied in the
# target environment (and TRIAL_IDENTITY_SALT is set). Off => fully inert.
TRIAL_IDENTITY_GATE_ENABLED = (
    os.getenv("TRIAL_IDENTITY_GATE_ENABLED", "false").strip().lower() == "true"
)

# Salt for the identity hash. Without it the hash is a plain email digest
# (rainbow-table-able), so the gate refuses to run (fail-closed) when enabled
# without a salt.
_SALT = os.getenv("TRIAL_IDENTITY_SALT", "").strip()


def _normalize_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    e = email.strip().lower()
    return e or None


def compute_identity_hash(email: Optional[str]) -> Optional[str]:
    """Salted SHA-256 of the normalized email, or None when there is no
    email to hash (caller treats None as unverifiable)."""
    norm = _normalize_email(email)
    if not norm:
        return None
    return hashlib.sha256(f"{_SALT}:{norm}".encode("utf-8")).hexdigest()


def evaluate_trial_gate(supabase, email: Optional[str]) -> dict:
    """Decide whether a fresh 60-day trial may be granted to this identity.

    Returns {allowed: bool, reason: str, identity_hash: Optional[str]}.

      flag OFF                  -> allowed=True,  reason='gate_disabled' (inert)
      no salt while enabled     -> allowed=False, reason='salt_missing'  (fail-closed)
      no email                  -> allowed=False, reason='identity_unverifiable'
      hash already in ledger    -> allowed=False, reason='prior_trial'
      ledger query error/missing-> allowed=False, reason='gate_error'    (fail-closed)
      otherwise                 -> allowed=True,  reason='ok' (+ hash to record)
    """
    if not TRIAL_IDENTITY_GATE_ENABLED:
        return {"allowed": True, "reason": "gate_disabled", "identity_hash": None}

    if not _SALT:
        print("[trial-gate] TRIAL_IDENTITY_SALT not set while gate enabled — failing closed")
        return {"allowed": False, "reason": "salt_missing", "identity_hash": None}

    h = compute_identity_hash(email)
    if not h:
        return {"allowed": False, "reason": "identity_unverifiable", "identity_hash": None}

    try:
        res = (
            supabase.table("trial_identity_ledger")
            .select("id")
            .eq("identity_hash", h)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        # Includes the table-missing case if the flag is flipped before the
        # migration lands. Fail-closed: withhold the trial, never grant
        # blind. Signup itself still succeeds.
        print(f"[trial-gate] ledger check failed, failing closed: {exc!r}")
        return {"allowed": False, "reason": "gate_error", "identity_hash": h}

    if res.data:
        return {"allowed": False, "reason": "prior_trial", "identity_hash": h}
    return {"allowed": True, "reason": "ok", "identity_hash": h}


def record_trial_identity(supabase, merchant_id: str, identity_hash: Optional[str]) -> None:
    """Record a granted trial in the ledger. Best-effort: a unique-violation
    means a concurrent signup already recorded this identity (the UNIQUE
    constraint did its job) and is ignored. No-op when the gate is disabled
    or there is no hash."""
    if not TRIAL_IDENTITY_GATE_ENABLED or not identity_hash:
        return
    try:
        supabase.table("trial_identity_ledger").insert({
            "merchant_id": merchant_id,
            "identity_hash": identity_hash,
        }).execute()
    except Exception as exc:  # noqa: BLE001
        msg = f"{getattr(exc, 'code', '')} {exc}".lower()
        if "23505" in msg or "duplicate" in msg or "unique" in msg:
            print(f"[trial-gate] ledger row already exists for merchant={merchant_id}")
            return
        print(f"[trial-gate] ledger insert failed (non-fatal) merchant={merchant_id}: {exc!r}")
