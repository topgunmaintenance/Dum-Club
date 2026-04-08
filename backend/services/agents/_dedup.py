"""
Receipt dedup helper.

Lifted from api/routes/external_business.py so the PurchaseProofAgent and
the route can use the same hashing function without one importing the other.
The hash semantics are unchanged — do not tweak without a corresponding
check that existing rows in purchase_proofs.duplicate_hash still match.
"""

from __future__ import annotations

import hashlib


def receipt_hash(buyer: str, business_id: str, amount: float, dt: str) -> str:
    """
    Deterministic dedup hash for a purchase proof.

    Inputs:
        buyer       buyer_privy_id
        business_id external_businesses.id
        amount      purchase amount in USD (truncated to 2 decimals)
        dt          purchase date as YYYY-MM-DD string

    Returns:
        32-char hex digest (first 32 chars of sha256).
    """
    raw = f"{buyer}:{business_id}:{amount:.2f}:{dt}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]
