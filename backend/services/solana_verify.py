"""
Shared Solana payment verification + USD/SOL pricing + HMAC quote
tokens.

This module is the single source of truth for "did this on-chain
SOL transfer actually happen?" — used by:
  - /api/checkout/sol-confirm   (live-offer SOL checkout)
  - /api/dum/swap               (SOL → DUM Points swap)

Behaviour for `verify_sol_transfer` matches the previous in-line
helper at backend/api/routes/dum_points.py exactly: same RPC
method (getTransaction), same 5%-fee tolerance on the lamport
delta against the treasury, same human-readable error strings.
The only addition is an optional `expected_sender` check so the
checkout path can refuse a tx that wasn't signed by the wallet
the buyer claims.

No new third-party deps — uses the `requests` package already
pulled in by dum_points.py.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional, Tuple

import requests as http_requests


# ── Solana RPC config ────────────────────────────────────────────

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
LAMPORTS_PER_SOL = 1_000_000_000


# ── Quote-token HMAC config ──────────────────────────────────────
# The quote token is the buyer-visible string we hand back from
# /sol-quote and require on /sol-confirm. It binds (offer_id,
# buyer_privy_id, lamports, expires_at) so a buyer can't substitute
# a stale quote, a different offer, or someone else's identity.

_QUOTE_HMAC_SECRET = os.getenv("SOL_CHECKOUT_QUOTE_HMAC_SECRET", "").strip()
QUOTE_TTL_SECONDS = 90


# ── USD → SOL price oracle ───────────────────────────────────────
# CoinGecko is the default. Cached in-process for 30s so a busy
# checkout page doesn't hammer the free tier. If the oracle call
# fails, fall back to SOL_PRICE_USD_FALLBACK so that a single
# upstream blip doesn't take checkout offline. Operators are
# expected to set the fallback to a conservative recent price.

_PRICE_CACHE: dict = {"price_usd": 0.0, "fetched_at": 0.0}
_PRICE_CACHE_TTL = 30  # seconds

_FALLBACK_SOL_USD = float(os.getenv("SOL_PRICE_USD_FALLBACK", "150"))
_PRICE_ORACLE = os.getenv("SOL_PRICE_ORACLE", "coingecko").strip().lower()


# ── Public: verify on-chain SOL transfer ─────────────────────────


def verify_sol_transfer(
    signature: str,
    expected_lamports: int,
    treasury: str,
    expected_sender: Optional[str] = None,
) -> "bool | str":
    """
    Verify that `signature` is a confirmed Solana transaction that
    moved at least `expected_lamports` to `treasury`.

    Returns True on success, or a human-readable error string on
    failure. Never raises for the common error paths — the caller
    is expected to surface the string back to the buyer.

    Args:
        signature:         Solana tx signature (base58).
        expected_lamports: How many lamports we expect the treasury
                           to have received. Allows 5% slack to
                           tolerate priority/network fees being
                           paid out of the same lamport budget.
        treasury:          The platform's receiving wallet (base58).
        expected_sender:   Optional — if set, the tx must have a
                           non-treasury account whose balance
                           DECREASED, and that account's pubkey must
                           equal expected_sender. Guards against a
                           buyer claiming someone else's payment.
    """
    if not signature or len(signature) < 20:
        return "Invalid transaction signature"
    if not treasury:
        return "Treasury wallet not configured"

    try:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                signature,
                {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
            ],
        }
        resp = http_requests.post(SOLANA_RPC_URL, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
    except http_requests.Timeout:
        return "Solana network is slow. Please wait a moment and try again."
    except Exception as exc:
        print(f"[solana-verify] RPC error sig={signature[:12]}…: {exc!r}")
        return f"Verification failed: {type(exc).__name__}"

    result = data.get("result")
    if not result:
        return (
            "Transaction not found on Solana. It may still be "
            "processing — wait a moment and try again."
        )

    meta = result.get("meta") or {}
    if meta.get("err") is not None:
        return "Transaction failed on-chain. The SOL transfer was not completed."

    account_keys = (
        result.get("transaction", {}).get("message", {}).get("accountKeys", [])
    )
    pre_balances = meta.get("preBalances") or []
    post_balances = meta.get("postBalances") or []

    treasury_received = False
    sender_decreased_match = expected_sender is None  # default-true if not asked

    for i, key in enumerate(account_keys):
        # accountKeys entries can be plain strings or objects with
        # {"pubkey": ..., "signer": ..., "writable": ...} shape
        # depending on the encoding negotiated. Normalise both.
        pubkey = key if isinstance(key, str) else (key.get("pubkey") or "")
        if not pubkey:
            continue
        pre = pre_balances[i] if i < len(pre_balances) else 0
        post = post_balances[i] if i < len(post_balances) else 0
        delta = post - pre

        if pubkey == treasury and delta >= int(expected_lamports * 0.95):
            treasury_received = True

        if expected_sender is not None and pubkey == expected_sender and delta < 0:
            # Sender balance went DOWN by at least the expected amount
            # (allowing extra for tx fee). |delta| should be ≥ expected.
            if -delta >= int(expected_lamports * 0.95):
                sender_decreased_match = True

    if not treasury_received:
        return (
            "SOL was not received by the DUM Club treasury. "
            "Check the destination address."
        )
    if not sender_decreased_match:
        return "Transaction was not sent from the wallet you claimed."

    return True


# ── USD ↔ SOL pricing ────────────────────────────────────────────


def get_sol_usd_price() -> float:
    """
    Return current SOL/USD spot price. In-process 30s cache; oracle
    fall-back is `SOL_PRICE_USD_FALLBACK`. Always returns a positive
    float — never zero.
    """
    now = time.time()
    cached = _PRICE_CACHE.get("price_usd", 0.0)
    fetched = _PRICE_CACHE.get("fetched_at", 0.0)
    if cached > 0 and (now - fetched) < _PRICE_CACHE_TTL:
        return cached

    price: float = 0.0
    if _PRICE_ORACLE == "coingecko":
        try:
            r = http_requests.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "solana", "vs_currencies": "usd"},
                timeout=8,
            )
            r.raise_for_status()
            data = r.json()
            price = float((data.get("solana") or {}).get("usd") or 0)
        except Exception as exc:
            print(f"[solana-verify] price oracle (coingecko) failed: {exc!r}")
            price = 0.0

    if price <= 0:
        price = _FALLBACK_SOL_USD

    _PRICE_CACHE["price_usd"] = price
    _PRICE_CACHE["fetched_at"] = now
    return price


def usd_to_lamports(usd_amount: float) -> Tuple[int, float]:
    """
    Convert a USD price to (lamports, sol_amount) at the current
    oracle rate. Rounds lamports up so the platform never under-
    charges by a fraction of a lamport.
    """
    if usd_amount <= 0:
        return 0, 0.0
    sol_per_usd = 1.0 / get_sol_usd_price()
    sol_amount = usd_amount * sol_per_usd
    lamports = int(sol_amount * LAMPORTS_PER_SOL) + 1  # round up
    return lamports, sol_amount


# ── Quote tokens (HMAC-signed) ───────────────────────────────────


class QuoteVerifyError(Exception):
    """Raised when a quote token can't be verified. Message is buyer-safe."""


def _quote_secret() -> bytes:
    if not _QUOTE_HMAC_SECRET:
        # Hard-fail: a missing HMAC secret would silently let
        # attackers forge quotes. Operators must set it explicitly.
        raise QuoteVerifyError(
            "SOL_CHECKOUT_QUOTE_HMAC_SECRET is not configured"
        )
    return _QUOTE_HMAC_SECRET.encode("utf-8")


def _b64u_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def make_quote_token(
    *,
    offer_id: str,
    buyer_privy_id: str,
    lamports: int,
    sol_amount: float,
    usd_amount: float,
    treasury: str,
    auction_id: Optional[str] = None,
    override_price: Optional[float] = None,
    now_ts: Optional[float] = None,
) -> Tuple[str, int]:
    """
    Build a `payload.signature` token a buyer hands back to /sol-confirm.

    Returns (token, expires_at_unix). The expiry is bound INTO the
    payload too; the caller doesn't have to pass it back separately.
    """
    issued = int(now_ts if now_ts is not None else time.time())
    expires = issued + QUOTE_TTL_SECONDS
    payload = {
        "v": 1,
        "offer_id": offer_id,
        "buyer_privy_id": buyer_privy_id,
        "lamports": int(lamports),
        "sol_amount": float(sol_amount),
        "usd_amount": float(usd_amount),
        "treasury": treasury,
        "iat": issued,
        "exp": expires,
    }
    if auction_id:
        payload["auction_id"] = auction_id
    if override_price is not None:
        payload["override_price"] = float(override_price)

    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    sig = hmac.new(_quote_secret(), body, hashlib.sha256).digest()
    token = f"{_b64u_encode(body)}.{_b64u_encode(sig)}"
    return token, expires


def verify_quote_token(
    token: str,
    *,
    expected_offer_id: Optional[str] = None,
    expected_buyer_privy_id: Optional[str] = None,
    now_ts: Optional[float] = None,
) -> dict:
    """
    Decode + verify a token produced by make_quote_token.

    Raises QuoteVerifyError on any tamper / expiry / mismatch.
    Returns the parsed payload on success.
    """
    if not token or "." not in token:
        raise QuoteVerifyError("Quote token is malformed")

    try:
        body_b64, sig_b64 = token.split(".", 1)
        body = _b64u_decode(body_b64)
        sig = _b64u_decode(sig_b64)
    except Exception:
        raise QuoteVerifyError("Quote token is malformed")

    expected_sig = hmac.new(_quote_secret(), body, hashlib.sha256).digest()
    if not hmac.compare_digest(sig, expected_sig):
        raise QuoteVerifyError("Quote token signature is invalid")

    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        raise QuoteVerifyError("Quote token payload is not JSON")

    now = int(now_ts if now_ts is not None else time.time())
    exp = int(payload.get("exp", 0))
    if exp <= 0 or now >= exp:
        raise QuoteVerifyError("Quote has expired — request a fresh one")

    if expected_offer_id and payload.get("offer_id") != expected_offer_id:
        raise QuoteVerifyError("Quote does not match this offer")
    if (
        expected_buyer_privy_id
        and payload.get("buyer_privy_id") != expected_buyer_privy_id
    ):
        raise QuoteVerifyError("Quote was issued for a different buyer")

    return payload


# ── Test seam ────────────────────────────────────────────────────


def _reset_price_cache_for_tests() -> None:
    """Clear the in-process price cache. Test-only entry point."""
    _PRICE_CACHE["price_usd"] = 0.0
    _PRICE_CACHE["fetched_at"] = 0.0
