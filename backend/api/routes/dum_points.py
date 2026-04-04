"""
DUM Points API — read balance, award points, spend points, purchase points.

All endpoints require a privy_id to identify the user.
Points are stored in users.dum_balance (integer).
"""

from __future__ import annotations

import os
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

# ── Stripe (lazy import, same pattern as checkout.py) ──
_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "")
_STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
_stripe = None

def _get_stripe():
    global _stripe
    if _stripe is None:
        try:
            import stripe
        except ImportError:
            raise HTTPException(status_code=503, detail="Stripe SDK not installed")
        if not _STRIPE_SECRET:
            raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not set")
        stripe.api_key = _STRIPE_SECRET
        _stripe = stripe
    return _stripe

# ── DUM Points purchase tiers ──
DUM_TIERS = {
    "tier_100": {"price_cents": 1000, "points": 100, "label": "$10 → 100 points"},
    "tier_275": {"price_cents": 2500, "points": 275, "label": "$25 → 275 points (10% bonus)"},
    "tier_600": {"price_cents": 5000, "points": 600, "label": "$50 → 600 points (20% bonus)"},
}


class DumBalanceResponse(BaseModel):
    privy_id: str
    balance: int


class DumAwardRequest(BaseModel):
    privy_id: str
    amount: int
    reason: str  # e.g. "launch", "offer_created", "purchase"


class DumSpendRequest(BaseModel):
    privy_id: str
    amount: int
    reason: str  # e.g. "discount", "game_unlock", "boost"
    project_id: Optional[str] = None  # for business credit


# ── Shared helper: update balance + log transaction ──────────

def _update_balance_and_log(
    supabase, privy_id: str, delta: int, reason: str, reference_id: str | None = None
) -> int:
    """
    Atomically update dum_balance and insert a dum_transactions row.
    Returns the new balance. `delta` is positive for earning, negative for spending.
    """
    res = (
        supabase.table("users")
        .select("dum_balance")
        .eq("privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")

    current = res.data[0].get("dum_balance", 0)
    new_balance = max(current + delta, 0)

    supabase.table("users").update(
        {"dum_balance": new_balance}
    ).eq("privy_id", privy_id).execute()

    # Log transaction
    try:
        supabase.table("dum_transactions").insert({
            "privy_id": privy_id,
            "amount": delta,
            "reason": reason,
            "reference_id": reference_id,
            "balance_after": new_balance,
        }).execute()
    except Exception as exc:
        print(f"[dum] transaction log failed (non-fatal): {exc!r}")

    print(f"[dum] {'+' if delta > 0 else ''}{delta} to {privy_id} ({reason}) → {new_balance}")
    return new_balance


# ── Read balance ──────────────────────────────────────────────

@router.get("/balance/{privy_id}", response_model=DumBalanceResponse)
async def get_balance(privy_id: str):
    supabase = get_client()
    res = (
        supabase.table("users")
        .select("privy_id, dum_balance")
        .eq("privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    row = res.data[0]
    return DumBalanceResponse(
        privy_id=row["privy_id"],
        balance=row.get("dum_balance", 50),
    )


# ── Transaction history ──────────────────────────────────────

@router.get("/transactions/{privy_id}")
async def get_transactions(privy_id: str, limit: int = 20):
    supabase = get_client()
    res = (
        supabase.table("dum_transactions")
        .select("*")
        .eq("privy_id", privy_id)
        .order("created_at", desc=True)
        .limit(min(limit, 50))
        .execute()
    )
    return {"transactions": res.data or []}


# ── Award points ──────────────────────────────────────────────

@router.post("/award", response_model=DumBalanceResponse)
async def award_points(
    req: DumAwardRequest,
    current_user: dict = Depends(get_current_user),
):
    auth_privy = current_user.get("sub")
    if not auth_privy:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    if auth_privy != req.privy_id:
        raise HTTPException(status_code=403, detail="Cannot modify another user's DUM balance")

    if req.amount <= 0 or req.amount > 1000:
        raise HTTPException(status_code=400, detail="Invalid amount (1-1000)")

    supabase = get_client()
    new_balance = _update_balance_and_log(supabase, req.privy_id, req.amount, req.reason)
    return DumBalanceResponse(privy_id=req.privy_id, balance=new_balance)


# ── Spend points ──────────────────────────────────────────────

@router.post("/spend", response_model=DumBalanceResponse)
async def spend_points(
    req: DumSpendRequest,
    current_user: dict = Depends(get_current_user),
):
    auth_privy = current_user.get("sub")
    if not auth_privy:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    if auth_privy != req.privy_id:
        raise HTTPException(status_code=403, detail="Cannot modify another user's DUM balance")

    if req.amount <= 0 or req.amount > 1000:
        raise HTTPException(status_code=400, detail="Invalid amount (1-1000)")

    supabase = get_client()

    # Check sufficient balance before spending
    res = supabase.table("users").select("dum_balance").eq("privy_id", req.privy_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    if res.data[0].get("dum_balance", 0) < req.amount:
        raise HTTPException(status_code=400, detail="Insufficient DUM Points")

    new_balance = _update_balance_and_log(
        supabase, req.privy_id, -req.amount, req.reason, req.project_id
    )

    # Credit business if project_id provided
    if req.project_id:
        try:
            proj_res = supabase.table("projects").select("dum_received").eq("id", req.project_id).limit(1).execute()
            if proj_res.data:
                current_received = proj_res.data[0].get("dum_received", 0)
                supabase.table("projects").update(
                    {"dum_received": current_received + req.amount}
                ).eq("id", req.project_id).execute()
        except Exception as exc:
            print(f"[dum] business credit failed (non-fatal): {exc!r}")

    return DumBalanceResponse(privy_id=req.privy_id, balance=new_balance)


# ── Purchase DUM Points via Stripe ──────────────────────────────

class DumPurchaseRequest(BaseModel):
    tier_id: str  # "tier_100", "tier_275", "tier_600"
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


@router.post("/purchase")
async def purchase_points(
    req: DumPurchaseRequest,
    current_user: dict = Depends(get_current_user),
):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    tier = DUM_TIERS.get(req.tier_id)
    if not tier:
        raise HTTPException(status_code=400, detail=f"Invalid tier: {req.tier_id}")

    s = _get_stripe()

    success_url = req.success_url or "https://dum-club.vercel.app/hub"
    cancel_url = req.cancel_url or "https://dum-club.vercel.app/hub"

    # Append ?dum_purchase=success to success URL
    sep = "&" if "?" in success_url else "?"
    success_url_final = f"{success_url}{sep}dum_purchase=success"

    session = s.checkout.Session.create(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": "usd",
                "unit_amount": tier["price_cents"],
                "product_data": {
                    "name": f"DUM Points — {tier['points']} points",
                    "description": tier["label"],
                },
            },
            "quantity": 1,
        }],
        metadata={
            "purchase_type": "dum_points",
            "privy_id": privy_id,
            "points_amount": str(tier["points"]),
            "tier_id": req.tier_id,
        },
        success_url=success_url_final,
        cancel_url=cancel_url,
    )

    print(f"[dum] purchase session created: {session.id} for {privy_id} → {tier['points']} points")
    return {
        "checkout_url": session.url,
        "session_id": session.id,
        "tier": req.tier_id,
        "points": tier["points"],
    }


# ── SOL → DUM Swap ──────────────────────────────────────────

import requests as http_requests
import time as _time

SOLANA_RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
DUM_TREASURY_WALLET = os.getenv("DUM_TREASURY_WALLET", "").strip()
LAMPORTS_PER_SOL = 1_000_000_000

# Swap limits
SWAP_MIN_SOL = 0.01
SWAP_MAX_SOL = 5.0
SWAP_COOLDOWN_SECONDS = 30  # minimum seconds between swaps per user

# Simple in-memory rate limiter (per-user last swap timestamp)
_swap_last_time: dict[str, float] = {}


class SwapRequest(BaseModel):
    sol_amount: float  # SOL amount sent
    tx_signature: str  # Solana transaction signature
    wallet_address: str  # Sender's wallet


def _verify_sol_transaction(signature: str, expected_lamports: int, treasury: str) -> bool | str:
    """
    Verify a SOL transfer landed in the treasury wallet via Solana RPC.
    Returns True on success, or an error string on failure.
    """
    try:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [signature, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}],
        }
        resp = http_requests.post(SOLANA_RPC_URL, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        result = data.get("result")
        if not result:
            return "Transaction not found on Solana. It may still be processing — wait a moment and try again."

        # Check transaction was successful
        meta = result.get("meta", {})
        if meta.get("err") is not None:
            return "Transaction failed on-chain. The SOL transfer was not completed."

        # Check post-balances for treasury receiving SOL
        account_keys = result.get("transaction", {}).get("message", {}).get("accountKeys", [])
        pre_balances = meta.get("preBalances", [])
        post_balances = meta.get("postBalances", [])

        for i, key in enumerate(account_keys):
            pubkey = key if isinstance(key, str) else key.get("pubkey", "")
            if pubkey == treasury:
                received = (post_balances[i] if i < len(post_balances) else 0) - (pre_balances[i] if i < len(pre_balances) else 0)
                if received >= expected_lamports * 0.95:  # 5% tolerance for fees
                    return True

        return "SOL was not received by the DUM Club treasury. Check the destination address."
    except http_requests.Timeout:
        return "Solana network is slow. Please wait a moment and try again."
    except Exception as exc:
        print(f"[swap] verification error: {exc!r}")
        return f"Verification failed: {type(exc).__name__}"


@router.post("/swap")
async def swap_sol_to_dum(
    req: SwapRequest,
    current_user: dict = Depends(get_current_user),
):
    """Swap SOL for DUM Points. Verifies on-chain transaction then awards points."""
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    # ── Input validation ──
    if req.sol_amount <= 0:
        raise HTTPException(status_code=400, detail="SOL amount must be positive")

    if req.sol_amount < SWAP_MIN_SOL:
        raise HTTPException(status_code=400, detail=f"Minimum swap is {SWAP_MIN_SOL} SOL")

    if req.sol_amount > SWAP_MAX_SOL:
        raise HTTPException(status_code=400, detail=f"Maximum swap is {SWAP_MAX_SOL} SOL per transaction")

    if not req.tx_signature or len(req.tx_signature) < 20:
        raise HTTPException(status_code=400, detail="Invalid transaction signature")

    if not req.wallet_address or len(req.wallet_address) < 20:
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    if not DUM_TREASURY_WALLET:
        raise HTTPException(status_code=503, detail="Treasury wallet not configured")

    # ── Rate limiting ──
    now = _time.time()
    last = _swap_last_time.get(privy_id, 0)
    if now - last < SWAP_COOLDOWN_SECONDS:
        wait = int(SWAP_COOLDOWN_SECONDS - (now - last))
        raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds before swapping again")

    # ── Calculate DUM ──
    dum_amount = int(req.sol_amount * DUM_SOL_RATE)
    if dum_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount too small to convert")

    # ── Check for duplicate FIRST (before expensive RPC call) ──
    supabase = get_client()
    dup_check = (
        supabase.table("dum_transactions")
        .select("id")
        .eq("reference_id", req.tx_signature)
        .limit(1)
        .execute()
    )
    if dup_check.data:
        raise HTTPException(status_code=409, detail="This transaction has already been processed")

    # ── Verify the SOL transaction on-chain ──
    expected_lamports = int(req.sol_amount * LAMPORTS_PER_SOL)
    verification = _verify_sol_transaction(req.tx_signature, expected_lamports, DUM_TREASURY_WALLET)

    if verification is not True:
        print(f"[swap] ✗ verification failed for tx={req.tx_signature}: {verification}")
        raise HTTPException(status_code=400, detail=verification)

    # ── Award DUM Points ──
    new_balance = _update_balance_and_log(
        supabase, privy_id, dum_amount, "swap_buy", req.tx_signature
    )

    # Update rate limiter
    _swap_last_time[privy_id] = _time.time()

    # Best-effort: mint SPL tokens on-chain
    try:
        from services.solana_mint import mint_dum_to_wallet, is_solana_enabled
        if is_solana_enabled() and req.wallet_address:
            mint_dum_to_wallet(req.wallet_address, dum_amount)
    except Exception as mint_err:
        print(f"[swap] on-chain mint failed (non-fatal): {mint_err}")

    print(f"[swap] ✓ {req.sol_amount} SOL → {dum_amount} DUM for {privy_id}")
    return {
        "status": "success",
        "sol_amount": req.sol_amount,
        "dum_received": dum_amount,
        "new_balance": new_balance,
        "tx_signature": req.tx_signature,
    }


# ── DUM Market data ──────────────────────────────────────────

DUM_SOL_RATE = float(os.getenv("DUM_SOL_RATE", "1000"))  # 1 SOL = 1000 DUM
DUM_USD_PRICE = 0.01  # Fixed price for display: $0.01 per DUM Point


@router.get("/market")
async def get_market_data():
    """Global DUM market overview — price, supply, volume."""
    supabase = get_client()

    # Total supply: sum of all user balances
    try:
        users_res = supabase.table("users").select("dum_balance").execute()
        total_supply = sum(row.get("dum_balance", 0) for row in (users_res.data or []))
    except Exception:
        total_supply = 0

    # 24h volume: sum of positive transactions in last 24h
    try:
        from datetime import datetime, timezone, timedelta
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        vol_res = (
            supabase.table("dum_transactions")
            .select("amount")
            .gt("amount", 0)
            .gte("created_at", cutoff)
            .execute()
        )
        volume_24h = sum(row.get("amount", 0) for row in (vol_res.data or []))
    except Exception:
        volume_24h = 0

    return {
        "price_usd": DUM_USD_PRICE,
        "sol_rate": DUM_SOL_RATE,
        "total_supply": total_supply,
        "market_cap_usd": round(total_supply * DUM_USD_PRICE, 2),
        "volume_24h": volume_24h,
        "volume_24h_usd": round(volume_24h * DUM_USD_PRICE, 2),
    }


@router.get("/recent-swaps")
async def get_recent_swaps(limit: int = 15):
    """Recent DUM Point transactions (platform-wide)."""
    supabase = get_client()
    res = (
        supabase.table("dum_transactions")
        .select("*")
        .order("created_at", desc=True)
        .limit(min(limit, 50))
        .execute()
    )
    return {"swaps": res.data or []}


@router.get("/price-history")
async def get_price_history(range: str = "7d"):
    """
    DUM Points activity over time — aggregated from dum_transactions.
    Returns data points for charting: timestamp + cumulative volume.
    Price is fixed at $0.01/DUM so chart shows activity volume, not price swings.
    """
    from datetime import datetime, timezone, timedelta

    range_map = {
        "24h": (timedelta(hours=24), timedelta(hours=1)),    # 24 points, 1 per hour
        "7d":  (timedelta(days=7), timedelta(hours=6)),      # 28 points, 1 per 6 hours
        "30d": (timedelta(days=30), timedelta(days=1)),      # 30 points, 1 per day
    }

    span, bucket_size = range_map.get(range, range_map["7d"])
    cutoff = datetime.now(timezone.utc) - span
    supabase = get_client()

    try:
        res = (
            supabase.table("dum_transactions")
            .select("amount, created_at")
            .gt("amount", 0)
            .gte("created_at", cutoff.isoformat())
            .order("created_at", desc=False)
            .execute()
        )
        txns = res.data or []
    except Exception:
        txns = []

    # Bucket transactions into time periods
    now = datetime.now(timezone.utc)
    num_buckets = max(int(span / bucket_size), 1)
    points = []
    cumulative = 0

    for i in range(num_buckets):
        bucket_start = cutoff + (bucket_size * i)
        bucket_end = bucket_start + bucket_size

        bucket_vol = sum(
            t.get("amount", 0) for t in txns
            if bucket_start.isoformat() <= (t.get("created_at") or "") < bucket_end.isoformat()
        )
        cumulative += bucket_vol

        points.append({
            "time": bucket_start.isoformat(),
            "volume": bucket_vol,
            "cumulative": cumulative,
            "price": DUM_USD_PRICE,
        })

    return {
        "range": range,
        "points": points,
        "price": DUM_USD_PRICE,
    }
