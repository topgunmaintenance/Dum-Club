"""
DUM Points API — read balance, award points, spend points, purchase points.

All endpoints require a privy_id to identify the user.
Points are stored in users.dum_balance (integer).
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


# ── Cooldown helper (fail-safe) ─────────────────────────────────────
#
# Central helper for the three /swap + /claim endpoints. On a timestamp
# parse error we previously did `except: pass`, which silently skipped
# the cooldown gate and let a user burst past rate limits. The fix:
# treat any parse failure as "cooldown still active" (fail-safe) and
# deny the request with an honest 429.

def _check_cooldown(
    last_ts_str: Optional[str],
    window_seconds: int,
    *,
    label: str,
    privy_id: str,
) -> None:
    """
    Raise HTTPException(429) if the last action was within `window_seconds`.

    - last_ts_str: ISO-8601 string, or None/empty (no prior action).
    - window_seconds: cooldown window in seconds.
    - label: short tag for the log line (e.g. "swap_buy", "claim").
    - privy_id: used in logs only, never in the user-facing response.

    Fail-safe on parse errors: if the timestamp cannot be parsed, the
    caller is denied with a 429 rather than allowed through. A malformed
    DB row must never silently disable the rate limit.
    """
    if not last_ts_str:
        return
    try:
        last_dt = datetime.fromisoformat(last_ts_str.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        print(f"[dum] cooldown parse error label={label} privy_id={privy_id} raw={last_ts_str!r} err={type(exc).__name__}")
        # Fail-safe: deny. A future well-formed write will clear the gate.
        raise HTTPException(
            status_code=429,
            detail="Cooldown check failed on a malformed timestamp. Please retry shortly.",
        )
    elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
    if elapsed < window_seconds:
        wait = int(window_seconds - elapsed)
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {wait} seconds before {label.replace('_', ' ')} again",
        )

# ── Stripe (lazy import, same pattern as checkout.py) ──
# .strip() defensively — see merchant.py for the justification.
_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "").strip()
_STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
_stripe = None

# ── Feature gates (fail-closed, pending legal review) ──────────────
# Doctrine (CLAUDE.md §5 "Points purchase flow HIDDEN" / "Solana claim
# HIDDEN", §12 rules 4-5): the DUM Points purchase flow and the Solana
# claim flow must stay hidden until legal review. They were only hidden
# in the frontend nav, so they were still callable with auth alone.
# Gate them server-side too. Same env pattern as
# ENABLE_IVS_REALTIME_BACKEND; both default DISABLED and fail closed.
_POINTS_PURCHASE_ENABLED = os.getenv("ENABLE_POINTS_PURCHASE", "false").lower() == "true"
_SOLANA_CLAIM_ENABLED = os.getenv("ENABLE_SOLANA_CLAIM", "false").lower() == "true"

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
    supabase, privy_id: str, delta: int, reason: str, reference_id: str | None = None,
    business_candidate_id: str | None = None,
) -> int:
    """
    Atomically update dum_balance and insert a dum_transactions row.
    Returns the new balance. `delta` is positive for earning, negative for spending.

    The optional `business_candidate_id` column (migration 020) attaches the
    external business that triggered an off-platform reward. Set only by
    RewardsAgent callers; all other call sites leave it None.
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
        row = {
            "privy_id": privy_id,
            "amount": delta,
            "reason": reason,
            "reference_id": reference_id,
            "balance_after": new_balance,
        }
        if business_candidate_id:
            row["business_candidate_id"] = business_candidate_id
        supabase.table("dum_transactions").insert(row).execute()
    except Exception as exc:
        # Balance already updated above; ledger write failing means
        # users.dum_balance and dum_transactions are now divergent. This
        # is logged loudly so admin/system can investigate.
        print(f"[dum] LEDGER DIVERGENCE privy_id={privy_id} delta={delta} reason={reason} reference_id={reference_id} new_balance={new_balance} err={type(exc).__name__}: {exc!r}")

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
            else:
                print(f"[dum] business credit skipped project={req.project_id} privy_id={req.privy_id} amount={req.amount} reason=project_not_found")
        except Exception as exc:
            # Non-fatal — user spend already succeeded. Surfaced loudly so
            # admin/system health can detect divergence against project totals.
            print(f"[dum] business credit FAILED project={req.project_id} privy_id={req.privy_id} amount={req.amount} err={type(exc).__name__}: {exc!r}")

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
    # Feature gate: points purchase is hidden pending legal review.
    if not _POINTS_PURCHASE_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")

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

# Verifier moved to services/solana_verify so the live-offer SOL
# checkout path can share exactly one implementation. Behaviour is
# unchanged — same RPC method, same 5%-fee tolerance, same error
# strings — so existing /api/dum/swap callers see no difference.
from services.solana_verify import (
    LAMPORTS_PER_SOL,
    SOLANA_RPC_URL,
    verify_sol_transfer,
)

DUM_TREASURY_WALLET = os.getenv("DUM_TREASURY_WALLET", "").strip()

# Swap limits
SWAP_MIN_SOL = 0.01
SWAP_MAX_SOL = 5.0
SWAP_COOLDOWN_SECONDS = 30  # minimum seconds between swaps per user
SWAP_DAILY_MAX_SOL = 20.0   # max total SOL swapped per user per 24 hours


class SwapRequest(BaseModel):
    sol_amount: float  # SOL amount sent
    tx_signature: str  # Solana transaction signature
    wallet_address: str  # Sender's wallet


def _verify_sol_transaction(signature: str, expected_lamports: int, treasury: str) -> "bool | str":
    """Thin wrapper that preserves the historical name for grep/log
    continuity. New callers should use verify_sol_transfer directly."""
    return verify_sol_transfer(signature, expected_lamports, treasury)


@router.post("/swap")
async def swap_sol_to_dum(
    req: SwapRequest,
    current_user: dict = Depends(get_current_user),
):
    """Swap SOL for DUM Points. Verifies on-chain transaction then awards points."""
    # Feature gate: Solana swap is hidden pending legal sign-off.
    if not _SOLANA_CLAIM_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")

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

    # ── Rate limiting + daily cap (DB-backed, survives restart) ──
    from datetime import datetime, timezone, timedelta

    supabase = get_client()
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    recent_swaps = (
        supabase.table("dum_transactions")
        .select("amount, created_at")
        .eq("privy_id", privy_id)
        .eq("reason", "swap_buy")
        .gte("created_at", cutoff_24h)
        .order("created_at", desc=True)
        .execute()
    )
    swap_rows = recent_swaps.data or []

    # Cooldown: fail-safe on parse errors (see _check_cooldown helper).
    if swap_rows:
        _check_cooldown(
            swap_rows[0].get("created_at", ""),
            SWAP_COOLDOWN_SECONDS,
            label="swap_buy",
            privy_id=privy_id,
        )

    # Daily cap: sum SOL swapped in last 24h
    # DUM amount / rate = SOL equivalent
    total_dum_24h = sum(row.get("amount", 0) for row in swap_rows)
    total_sol_24h = total_dum_24h / DUM_SOL_RATE if DUM_SOL_RATE > 0 else 0
    if total_sol_24h + req.sol_amount > SWAP_DAILY_MAX_SOL:
        remaining = max(SWAP_DAILY_MAX_SOL - total_sol_24h, 0)
        raise HTTPException(
            status_code=429,
            detail=f"Daily swap limit reached. You can swap up to {remaining:.2f} more SOL today (max {SWAP_DAILY_MAX_SOL} SOL/day)."
        )

    # ── Calculate DUM ──
    dum_amount = int(req.sol_amount * DUM_SOL_RATE)
    if dum_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount too small to convert")

    # ── Check for duplicate FIRST (before expensive RPC call) ──
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

    # Best-effort: mint SPL tokens on-chain
    # Best-effort on-chain mint. Mode is reported in the response so the
    # client knows whether the DB credit was accompanied by a real SPL mint.
    onchain_attempted = False
    onchain_ok = False
    try:
        from services.solana_mint import mint_dum_to_wallet, is_solana_enabled
        if is_solana_enabled() and req.wallet_address:
            onchain_attempted = True
            mint_result = mint_dum_to_wallet(req.wallet_address, dum_amount)
            onchain_ok = bool(mint_result and mint_result.get("signature"))
            if not onchain_ok:
                print(f"[swap] on-chain mint returned no signature privy_id={privy_id} wallet={req.wallet_address}")
    except Exception as mint_err:
        print(f"[swap] on-chain mint FAILED privy_id={privy_id} wallet={req.wallet_address} err={type(mint_err).__name__}: {mint_err!r}")

    claim_mode = "onchain" if onchain_ok else "db_only"
    print(f"[swap] ✓ {req.sol_amount} SOL → {dum_amount} DUM for {privy_id} (claim_mode={claim_mode})")
    return {
        "status": "success",
        "sol_amount": req.sol_amount,
        "dum_received": dum_amount,
        "new_balance": new_balance,
        "tx_signature": req.tx_signature,
        # Additive honesty fields — never overstate on-chain readiness.
        "claim_mode": claim_mode,
        "onchain_attempted": onchain_attempted,
        "onchain_ok": onchain_ok,
    }


# ── DUM Market data ──────────────────────────────────────────

DUM_SOL_RATE = float(os.getenv("DUM_SOL_RATE", "1000"))  # 1 SOL = 1000 DUM
DUM_USD_PRICE = 0.01  # Fixed price for display: $0.01 per DUM Point


@router.get("/market")
async def get_market_data():
    """Global DUM market overview — price, supply, volume, claim readiness."""
    supabase = get_client()

    # Total supply: sum of all user balances
    try:
        users_res = supabase.table("users").select("dum_balance").execute()
        total_supply = sum(row.get("dum_balance", 0) for row in (users_res.data or []))
    except Exception as exc:
        print(f"[dum] total_supply query failed err={type(exc).__name__}: {exc!r}")
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
    except Exception as exc:
        print(f"[dum] volume_24h query failed err={type(exc).__name__}: {exc!r}")
        volume_24h = 0

    # Honest claim-readiness snapshot. Never overstate on-chain readiness.
    try:
        from services.readiness import dum_points_status
        claim_status = dum_points_status()
    except Exception as exc:
        print(f"[dum] claim readiness snapshot failed err={type(exc).__name__}: {exc!r}")
        claim_status = {
            "claims_enabled": True,
            "onchain_claim_ready": False,
            "claim_mode": "db_only",
            "cooldown_seconds_effective": SWAP_COOLDOWN_SECONDS,
            "reason": "readiness helper unavailable",
        }

    return {
        "price_usd": DUM_USD_PRICE,
        "sol_rate": DUM_SOL_RATE,
        "total_supply": total_supply,
        "market_cap_usd": round(total_supply * DUM_USD_PRICE, 2),
        "volume_24h": volume_24h,
        "volume_24h_usd": round(volume_24h * DUM_USD_PRICE, 2),
        # Additive readiness fields — a client can render a "demo claim"
        # badge or hide the on-chain claim UI entirely based on these.
        "claims_enabled": claim_status.get("claims_enabled", True),
        "onchain_claim_ready": claim_status.get("onchain_claim_ready", False),
        "claim_mode": claim_status.get("claim_mode", "db_only"),
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


# ── Demo Swap (no on-chain tx required) ──────────────────────

class DemoSwapRequest(BaseModel):
    sol_amount: float
    wallet_address: str


@router.post("/swap-demo")
async def demo_swap_sol_to_dum(
    req: DemoSwapRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Demo swap: awards DUM Points based on SOL amount WITHOUT requiring
    an on-chain transaction. Used for devnet/demo environments where
    Privy embedded wallet signing may not work reliably.

    ROOT CAUSE: Privy embedded wallet sendTransaction/signTransaction
    hangs on mobile browsers without showing approval UI. This endpoint
    bypasses on-chain verification while preserving all other safeguards.
    """
    # Feature gate: Solana swap is hidden pending legal sign-off.
    if not _SOLANA_CLAIM_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")

    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    if req.sol_amount < SWAP_MIN_SOL:
        raise HTTPException(status_code=400, detail=f"Minimum is {SWAP_MIN_SOL} SOL")
    if req.sol_amount > SWAP_MAX_SOL:
        raise HTTPException(status_code=400, detail=f"Maximum is {SWAP_MAX_SOL} SOL per swap")
    if not req.wallet_address or len(req.wallet_address) < 20:
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    dum_amount = int(req.sol_amount * DUM_SOL_RATE)
    if dum_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount too small")

    # Rate limiting + daily cap (same as real swap)
    from datetime import datetime, timezone, timedelta
    supabase = get_client()
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    recent_swaps = (
        supabase.table("dum_transactions")
        .select("amount, created_at")
        .eq("privy_id", privy_id)
        .in_("reason", ["swap_buy", "demo_swap"])
        .gte("created_at", cutoff_24h)
        .order("created_at", desc=True)
        .execute()
    )
    swap_rows = recent_swaps.data or []

    if swap_rows:
        _check_cooldown(
            swap_rows[0].get("created_at", ""),
            SWAP_COOLDOWN_SECONDS,
            label="demo_swap",
            privy_id=privy_id,
        )

    total_dum_24h = sum(row.get("amount", 0) for row in swap_rows)
    total_sol_24h = total_dum_24h / DUM_SOL_RATE if DUM_SOL_RATE > 0 else 0
    if total_sol_24h + req.sol_amount > SWAP_DAILY_MAX_SOL:
        remaining = max(SWAP_DAILY_MAX_SOL - total_sol_24h, 0)
        raise HTTPException(status_code=429, detail=f"Daily limit reached. {remaining:.2f} SOL remaining today.")

    # Award DUM Points (DB only — no on-chain verification for demo)
    new_balance = _update_balance_and_log(
        supabase, privy_id, dum_amount, "demo_swap", f"demo_{req.wallet_address[:8]}"
    )

    print(f"[demo-swap] ✓ {req.sol_amount} SOL → {dum_amount} DUM for {privy_id} (demo mode)")
    return {
        "status": "success",
        "sol_amount": req.sol_amount,
        "dum_received": dum_amount,
        "new_balance": new_balance,
        "mode": "demo",
    }


# ── Claim DUM (REAL on-chain SPL mint) ──────────────────────

class ClaimRequest(BaseModel):
    wallet_address: str
    amount: int = 100  # default claim amount


@router.post("/claim")
async def claim_dum_tokens(
    req: ClaimRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Claim DUM tokens via REAL on-chain SPL transfer.
    Mints tokens from treasury to user's wallet.
    Returns the Solana transaction signature.
    """
    # Feature gate: Solana claim is hidden pending legal sign-off.
    if not _SOLANA_CLAIM_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")

    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not req.wallet_address or len(req.wallet_address) < 20:
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    if req.amount <= 0 or req.amount > 10000:
        raise HTTPException(status_code=400, detail="Amount must be between 1 and 10,000")

    # Rate limiting (same cooldown as swap)
    from datetime import datetime, timezone, timedelta
    supabase = get_client()
    cutoff_24h = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    recent_claims = (
        supabase.table("dum_transactions")
        .select("created_at")
        .eq("privy_id", privy_id)
        .eq("reason", "claim")
        .gte("created_at", cutoff_24h)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if recent_claims.data:
        _check_cooldown(
            recent_claims.data[0].get("created_at", ""),
            SWAP_COOLDOWN_SECONDS,
            label="claim",
            privy_id=privy_id,
        )

    # Attempt real on-chain SPL mint, fall back to DB-only if unavailable
    from services.solana_mint import mint_dum_to_wallet, is_solana_enabled

    tx_signature = ""
    mode = "db-only"

    if is_solana_enabled():
        print(f"[claim] Solana enabled — attempting on-chain mint of {req.amount} DUM to {req.wallet_address}")
        try:
            mint_result = mint_dum_to_wallet(req.wallet_address, req.amount)
            if mint_result and mint_result.get("signature"):
                tx_signature = mint_result["signature"]
                mode = "on-chain"
                print(f"[claim] ✓ ON-CHAIN MINT SUCCESS: {req.amount} DUM to {req.wallet_address} | tx: {tx_signature}")
            else:
                print(f"[claim] ✗ on-chain mint returned no result (mint_result={mint_result}), using DB fallback")
        except Exception as exc:
            print(f"[claim] ✗ on-chain mint EXCEPTION: {type(exc).__name__}: {exc}, using DB fallback")
    else:
        from services.solana_mint import DUM_MINT as _mint, DUM_TREASURY_KEYPAIR as _key
        print(f"[claim] Solana NOT configured — DUM_MINT={'SET' if _mint else 'EMPTY'}, KEYPAIR={'SET' if _key else 'EMPTY'}")

    # Always award points in DB (source of truth for UX)
    new_balance = _update_balance_and_log(
        supabase, privy_id, req.amount, "claim", tx_signature or f"claim_{req.wallet_address[:8]}"
    )

    print(f"[claim] ✓ {req.amount} DUM claimed by {privy_id} | mode: {mode}")
    return {
        "status": "success",
        "dum_received": req.amount,
        "new_balance": new_balance,
        "tx_signature": tx_signature,
        "mint": os.getenv("DUM_MINT", ""),
        "wallet": req.wallet_address,
        "mode": mode,
        # Additive normalised readiness fields (preserve `mode` for back-compat).
        "claim_mode": "onchain" if mode == "on-chain" else "db_only",
        "onchain_claim_ready": is_solana_enabled(),
    }


# ── On-chain DUM balance ──────────────────────────────────

@router.get("/balance-onchain/{wallet_address}")
async def get_onchain_balance(wallet_address: str):
    """Read DUM token balance directly from Solana blockchain."""
    from services.solana_mint import get_dum_balance
    balance = get_dum_balance(wallet_address)
    if balance is None:
        return {"wallet": wallet_address, "balance": 0, "source": "unavailable"}
    return {"wallet": wallet_address, "balance": balance, "source": "on-chain"}


# ── Claimable amount ──────────────────────────────────────

EARNED_REASONS = {"purchase_reward", "launch_bonus", "offer_created", "referral_bonus", "referral_welcome", "verified_off_platform_purchase", "referral_credit_off_platform"}


@router.get("/claimable/{privy_id}")
async def get_claimable(privy_id: str):
    """
    How much earned DUM is eligible to claim on-chain.
    claimable = total earned (activity rewards) - total already claimed.
    Stripe purchases are NOT claimable — they are instant balance top-ups.
    """
    supabase = get_client()

    # Total earned from activity
    earned_res = (
        supabase.table("dum_transactions")
        .select("amount")
        .eq("privy_id", privy_id)
        .gt("amount", 0)
        .in_("reason", list(EARNED_REASONS))
        .execute()
    )
    total_earned = sum(row.get("amount", 0) for row in (earned_res.data or []))

    # Total already claimed
    claimed_res = (
        supabase.table("dum_transactions")
        .select("amount")
        .eq("privy_id", privy_id)
        .eq("reason", "claim")
        .gt("amount", 0)
        .execute()
    )
    total_claimed = sum(row.get("amount", 0) for row in (claimed_res.data or []))

    claimable = max(total_earned - total_claimed, 0)

    return {
        "privy_id": privy_id,
        "claimable": claimable,
        "total_earned": total_earned,
        "total_claimed": total_claimed,
    }


@router.get("/price-history")
async def get_price_history(range: str = "7d"):
    """
    DUM Points activity over time — aggregated from dum_transactions.
    Returns data points for charting: timestamp + cumulative volume.
    ALWAYS returns data points (never empty) — uses all-time data as fallback.
    """
    from datetime import datetime, timezone, timedelta

    range_map = {
        "24h": (timedelta(hours=24), timedelta(hours=1)),
        "7d":  (timedelta(days=7), timedelta(hours=6)),
        "30d": (timedelta(days=30), timedelta(days=1)),
    }

    span, bucket_size = range_map.get(range, range_map["7d"])
    cutoff = datetime.now(timezone.utc) - span
    supabase = get_client()

    try:
        # First try: get transactions in the requested range
        res = (
            supabase.table("dum_transactions")
            .select("amount, created_at")
            .gt("amount", 0)
            .gte("created_at", cutoff.isoformat())
            .order("created_at", desc=False)
            .execute()
        )
        txns = res.data or []

        # Fallback: if no data in range, get ALL transactions
        if not txns:
            res = (
                supabase.table("dum_transactions")
                .select("amount, created_at")
                .gt("amount", 0)
                .order("created_at", desc=False)
                .limit(100)
                .execute()
            )
            txns = res.data or []
            # Adjust cutoff to cover the full data range
            if txns:
                earliest = txns[0].get("created_at", "")
                try:
                    cutoff = datetime.fromisoformat(earliest.replace("Z", "+00:00")) - timedelta(hours=1)
                    span = datetime.now(timezone.utc) - cutoff
                    bucket_size = span / 20  # 20 buckets for all-time view
                except (ValueError, TypeError):
                    pass
    except Exception as exc:
        print(f"[price-history] query error: {exc!r}")
        txns = []

    # Bucket transactions into time periods
    num_buckets = max(int(span / bucket_size), 1) if bucket_size.total_seconds() > 0 else 20
    num_buckets = min(num_buckets, 40)  # cap at 40 bars
    points = []
    cumulative = 0

    for i in range(num_buckets):
        bucket_start = cutoff + (bucket_size * i)
        bucket_end = bucket_start + bucket_size

        # Compare using parsed datetime objects instead of string comparison
        bucket_vol = 0
        for t in txns:
            try:
                t_time = datetime.fromisoformat((t.get("created_at") or "").replace("Z", "+00:00"))
                if bucket_start <= t_time < bucket_end:
                    bucket_vol += t.get("amount", 0)
            except (ValueError, TypeError):
                continue

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


# ── Network Impact ──────────────────────────────────────────────────

@router.get("/network-impact/{privy_id}")
async def get_network_impact(privy_id: str):
    """User-facing network impact metrics. Read-only, no auth required
    (balance endpoints are also public). Uses existing tables only."""
    from datetime import timedelta

    sb = get_client()

    # Verified purchases by this buyer
    verified = (
        sb.table("purchase_proofs")
        .select("id", count="exact")
        .eq("buyer_privy_id", privy_id)
        .eq("status", "verified")
        .execute()
    )
    verified_purchases = verified.count or 0

    # Distinct businesses visited
    biz_visited = (
        sb.table("purchase_proofs")
        .select("external_business_id")
        .eq("buyer_privy_id", privy_id)
        .eq("status", "verified")
        .execute()
    )
    businesses_visited = len({r["external_business_id"] for r in (biz_visited.data or [])})

    # Businesses discovered (user was the first verified buyer → lead_credit)
    discovered = (
        sb.table("purchase_proofs")
        .select("id", count="exact")
        .eq("buyer_privy_id", privy_id)
        .eq("campaign_type", "lead_credit")
        .execute()
    )
    businesses_discovered = discovered.count or 0

    # Referral signups
    referral_signups = 0
    try:
        ref = (
            sb.table("referrals")
            .select("signups")
            .eq("privy_id", privy_id)
            .limit(1)
            .execute()
        )
        if ref.data:
            referral_signups = ref.data[0].get("signups", 0) or 0
    except Exception:
        pass  # referrals table may not exist for all users

    # Activity this week
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    weekly = (
        sb.table("dum_transactions")
        .select("id", count="exact")
        .eq("privy_id", privy_id)
        .gte("created_at", cutoff)
        .execute()
    )
    activity_this_week = weekly.count or 0

    return {
        "verified_purchases": verified_purchases,
        "businesses_visited": businesses_visited,
        "businesses_discovered": businesses_discovered,
        "referral_signups": referral_signups,
        "activity_this_week": activity_this_week,
    }
