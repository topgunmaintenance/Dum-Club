"""
Reliability helpers — honest, read-only status snapshots for config-driven
subsystems. Used by health/system endpoints and by tagged logs so we never
overstate readiness.

Rules:
    - Never expose secrets. Only booleans, mode strings, and public IDs.
    - Never lie about readiness. If any required piece of config is
      missing, the subsystem is NOT ready.
    - Never mutate state. Pure read of environment + module-level state.
    - Never raise. Defensive for every lookup.

This module is imported at startup by the email + solana services, and by
backend/api/routes/health.py. Keep imports light — no heavy deps.
"""

from __future__ import annotations

import os
from typing import Any


# ── Defensive primitives ───────────────────────────────────────────────


def safe_int(value: Any, default: int) -> int:
    """Parse an int from an arbitrary value, returning default on any failure."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_float(value: Any, default: float) -> float:
    """Parse a float from an arbitrary value, returning default on any failure."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def env_flag(name: str) -> bool:
    """True when the env var is set to a non-empty, non-whitespace value."""
    return bool((os.getenv(name) or "").strip())


# ── Email ──────────────────────────────────────────────────────────────


def email_status() -> dict:
    """
    Email subsystem readiness. Reports whether Resend is configured.

    Fields:
        enabled:         True when a real send will be attempted
        provider:        always "resend" in the current build
        key_set:         RESEND_API_KEY present
        from_address:    EMAIL_FROM value (not a secret)
        mode:            "enabled" | "disabled"
        reason:          short reason when disabled
    """
    key_set = env_flag("RESEND_API_KEY")
    from_address = os.getenv("EMAIL_FROM", "").strip() or "DUM Club <orders@dum.club>"
    enabled = key_set
    reason = "" if enabled else "RESEND_API_KEY is not set — email delivery disabled"
    return {
        "enabled": enabled,
        "provider": "resend",
        "key_set": key_set,
        "from_address": from_address,
        "mode": "enabled" if enabled else "disabled",
        "reason": reason,
    }


# ── Solana on-chain mint / claim ────────────────────────────────────────


def solana_status() -> dict:
    """
    Solana on-chain mint/claim readiness.

    The underlying module is `services.solana_mint`. That module also
    disables its keypair at import time if it is JSON-array-formatted
    (see solana_mint.py). We prefer the module's own state over reading
    env vars directly so the two cannot diverge.

    Fields:
        mint_set:              DUM_MINT env var present
        keypair_set:           DUM_TREASURY_KEYPAIR present AND not auto-disabled
        treasury_wallet_set:   DUM_TREASURY_WALLET present (used by SOL deposit verify)
        rpc_url:               SOLANA_RPC_URL (public, not a secret)
        mint_enabled:          solana_mint.is_solana_enabled()
        reason:                short reason when not enabled
    """
    mint_enabled = False
    mint_set = False
    keypair_set = False
    treasury_wallet_set = env_flag("DUM_TREASURY_WALLET")
    rpc_url = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
    reason = ""

    try:
        from services import solana_mint as _sm

        mint_set = bool(_sm.DUM_MINT)
        keypair_set = bool(_sm.DUM_TREASURY_KEYPAIR)
        mint_enabled = bool(_sm.is_solana_enabled())
    except Exception as exc:
        reason = f"solana_mint module unavailable: {type(exc).__name__}"

    if not mint_enabled and not reason:
        if not mint_set and not keypair_set:
            reason = "DUM_MINT and DUM_TREASURY_KEYPAIR are not set"
        elif not mint_set:
            reason = "DUM_MINT is not set"
        elif not keypair_set:
            reason = "DUM_TREASURY_KEYPAIR is not set or was auto-disabled at import (check for JSON-array format)"

    return {
        "mint_set": mint_set,
        "keypair_set": keypair_set,
        "treasury_wallet_set": treasury_wallet_set,
        "rpc_url": rpc_url,
        "mint_enabled": mint_enabled,
        "reason": reason,
    }


# ── DUM Points claim mode ──────────────────────────────────────────────


def dum_claim_mode() -> str:
    """
    One of:
        "onchain"  — DUM_MINT + DUM_TREASURY_KEYPAIR set, claim will attempt on-chain mint
        "db_only"  — config missing, claim will fall back to DB-only award
        "disabled" — DUM Points claims are hard-disabled (reserved — currently unused)
    """
    return "onchain" if solana_status()["mint_enabled"] else "db_only"


def dum_points_status() -> dict:
    """
    DUM Points subsystem readiness. Combines swap + claim + cooldown state.

    Fields:
        claims_enabled:              True when claims accept new requests
        onchain_claim_ready:         True when a claim will actually hit Solana
        claim_mode:                  "onchain" | "db_only" | "disabled"
        cooldown_seconds_effective:  the cooldown the route enforces today
        swap_min_sol:                current SOL floor for a swap
        swap_max_sol:                current per-transaction SOL ceiling
        swap_daily_max_sol:          current per-user 24h SOL ceiling
        treasury_wallet_set:         whether SOL deposit verify is configured
        reason:                      short reason if anything is degraded
    """
    sol = solana_status()

    # Import the dum_points route module to read the canonical cooldown
    # constants without duplicating them. Fall back to the documented
    # defaults if import fails for any reason.
    cooldown_seconds = 30
    swap_min = 0.01
    swap_max = 5.0
    swap_daily_max = 20.0
    try:
        from api.routes import dum_points as _dp

        cooldown_seconds = safe_int(getattr(_dp, "SWAP_COOLDOWN_SECONDS", 30), 30)
        swap_min = safe_float(getattr(_dp, "SWAP_MIN_SOL", 0.01), 0.01)
        swap_max = safe_float(getattr(_dp, "SWAP_MAX_SOL", 5.0), 5.0)
        swap_daily_max = safe_float(getattr(_dp, "SWAP_DAILY_MAX_SOL", 20.0), 20.0)
    except Exception:
        # If dum_points can't import, leave defaults and continue —
        # this helper must never crash a health endpoint.
        pass

    claims_enabled = True  # The /claim route is always callable. It may
                           # just fall back to db_only when solana is off.
    onchain_ready = bool(sol["mint_enabled"])
    claim_mode = "onchain" if onchain_ready else "db_only"

    reason = ""
    if not onchain_ready:
        reason = sol["reason"] or "on-chain mint path is not configured; claims will fall back to DB-only"

    return {
        "claims_enabled": claims_enabled,
        "onchain_claim_ready": onchain_ready,
        "claim_mode": claim_mode,
        "cooldown_seconds_effective": cooldown_seconds,
        "swap_min_sol": swap_min,
        "swap_max_sol": swap_max,
        "swap_daily_max_sol": swap_daily_max,
        "treasury_wallet_set": sol["treasury_wallet_set"],
        "reason": reason,
    }
