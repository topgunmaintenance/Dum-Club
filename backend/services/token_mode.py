"""
Token mode helper — single source of truth for "is this a simulated (SIM_)
token or a real on-chain token?"

All backend responses that return token_mint_address should carry
`is_simulated` and `token_mode` fields derived from this helper so the
frontend never has to string-match `SIM_` directly.

Do NOT use this helper for DUM Points. DUM Points are a separate system
(real Stripe on-ramp + optional on-chain claim) and are out of scope for
the Door A (simulated-token labeling) PR.
"""

from __future__ import annotations

from typing import Literal


TokenMode = Literal["simulated", "on_chain"]


def is_simulated_token(token_mint_address: str | None) -> bool:
    """
    True when the mint address is missing or is a simulated placeholder.

    The ``SIM_`` prefix is written by backend/api/routes/token.py and
    backend/api/routes/launch.py at project-creation time. A missing
    mint is also treated as simulated — there is no live token to point
    at yet, so callers should never advertise live-market behavior.
    """
    if not token_mint_address:
        return True
    return token_mint_address.startswith("SIM_")


def token_mode(token_mint_address: str | None) -> TokenMode:
    """Return 'simulated' or 'on_chain' for a given mint address."""
    return "simulated" if is_simulated_token(token_mint_address) else "on_chain"
