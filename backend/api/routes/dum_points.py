"""
DUM Points API — read balance, award points, spend points.

All endpoints require a privy_id to identify the user.
Points are stored in users.dum_balance (integer).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()


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


# ── Award points ──────────────────────────────────────────────

@router.post("/award", response_model=DumBalanceResponse)
async def award_points(
    req: DumAwardRequest,
    current_user: dict = Depends(get_current_user),
):
    # Enforce: authenticated user can only award to themselves
    auth_privy = current_user.get("sub")
    if not auth_privy:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    if auth_privy != req.privy_id:
        raise HTTPException(status_code=403, detail="Cannot modify another user's DUM balance")

    if req.amount <= 0 or req.amount > 1000:
        raise HTTPException(status_code=400, detail="Invalid amount (1-1000)")

    supabase = get_client()

    # Read current balance
    res = (
        supabase.table("users")
        .select("privy_id, dum_balance")
        .eq("privy_id", req.privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")

    current = res.data[0].get("dum_balance", 50)
    new_balance = current + req.amount

    supabase.table("users").update(
        {"dum_balance": new_balance}
    ).eq("privy_id", req.privy_id).execute()

    print(f"[dum] awarded {req.amount} to {req.privy_id} ({req.reason}) → {new_balance}")
    return DumBalanceResponse(privy_id=req.privy_id, balance=new_balance)


# ── Spend points ──────────────────────────────────────────────

@router.post("/spend", response_model=DumBalanceResponse)
async def spend_points(
    req: DumSpendRequest,
    current_user: dict = Depends(get_current_user),
):
    # Enforce: authenticated user can only spend their own points
    auth_privy = current_user.get("sub")
    if not auth_privy:
        raise HTTPException(status_code=401, detail="Invalid auth token")
    if auth_privy != req.privy_id:
        raise HTTPException(status_code=403, detail="Cannot modify another user's DUM balance")

    if req.amount <= 0 or req.amount > 1000:
        raise HTTPException(status_code=400, detail="Invalid amount (1-1000)")

    supabase = get_client()

    # Read current balance
    res = (
        supabase.table("users")
        .select("privy_id, dum_balance")
        .eq("privy_id", req.privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")

    current = res.data[0].get("dum_balance", 50)
    if current < req.amount:
        raise HTTPException(status_code=400, detail="Insufficient DUM Points")

    new_balance = current - req.amount

    supabase.table("users").update(
        {"dum_balance": new_balance}
    ).eq("privy_id", req.privy_id).execute()

    # Credit business if project_id provided
    if req.project_id:
        try:
            proj_res = (
                supabase.table("projects")
                .select("dum_received")
                .eq("id", req.project_id)
                .limit(1)
                .execute()
            )
            if proj_res.data:
                current_received = proj_res.data[0].get("dum_received", 0)
                supabase.table("projects").update(
                    {"dum_received": current_received + req.amount}
                ).eq("id", req.project_id).execute()
                print(f"[dum] credited {req.amount} to project {req.project_id}")
        except Exception as exc:
            print(f"[dum] business credit failed (non-fatal): {exc!r}")

    print(f"[dum] spent {req.amount} from {req.privy_id} ({req.reason}) → {new_balance}")
    return DumBalanceResponse(privy_id=req.privy_id, balance=new_balance)
