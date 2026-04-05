"""
Referrals — generate codes, track clicks, award DUM points on signup.
"""
import secrets
import string

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

REFERRAL_REWARD = 25  # DUM points awarded per successful referral signup


def _generate_code() -> str:
    """Generate a short, human-friendly referral code."""
    chars = string.ascii_uppercase + string.digits
    return "DUM-" + "".join(secrets.choice(chars) for _ in range(6))


@router.get("/mine")
def get_or_create_referral(user: dict = Depends(get_current_user)):
    """Return the user's referral code, creating one if needed."""
    privy_id = user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    sb = get_client()

    existing = (
        sb.table("referrals")
        .select("*")
        .eq("privy_id", privy_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        row = existing.data[0]
        return {
            "code": row["code"],
            "clicks": row["clicks"],
            "signups": row["signups"],
            "points_earned": row["points_earned"],
        }

    # Create new referral code
    code = _generate_code()
    sb.table("referrals").insert({
        "privy_id": privy_id,
        "code": code,
    }).execute()

    return {"code": code, "clicks": 0, "signups": 0, "points_earned": 0}


@router.post("/click/{code}")
def track_click(code: str):
    """Public: increment click count for a referral code."""
    sb = get_client()

    existing = (
        sb.table("referrals")
        .select("id, clicks")
        .eq("code", code)
        .limit(1)
        .execute()
    )

    if not existing.data:
        raise HTTPException(status_code=404, detail="Referral code not found")

    row = existing.data[0]
    sb.table("referrals").update({
        "clicks": (row["clicks"] or 0) + 1,
    }).eq("id", row["id"]).execute()

    return {"status": "ok"}


@router.post("/convert/{code}")
def convert_referral(code: str, user: dict = Depends(get_current_user)):
    """Called when a referred user signs up. Awards points to the referrer."""
    new_user_privy = user.get("sub")
    if not new_user_privy:
        raise HTTPException(status_code=401, detail="Invalid token")

    sb = get_client()

    ref = (
        sb.table("referrals")
        .select("id, privy_id, signups, points_earned")
        .eq("code", code)
        .limit(1)
        .execute()
    )

    if not ref.data:
        raise HTTPException(status_code=404, detail="Referral code not found")

    row = ref.data[0]

    # Don't let users refer themselves
    if row["privy_id"] == new_user_privy:
        return {"status": "self_referral", "points_awarded": 0}

    # Update referral stats
    new_signups = (row["signups"] or 0) + 1
    new_points = (row["points_earned"] or 0) + REFERRAL_REWARD

    sb.table("referrals").update({
        "signups": new_signups,
        "points_earned": new_points,
    }).eq("id", row["id"]).execute()

    # Award DUM points to the referrer
    referrer_privy = row["privy_id"]

    # Get current balance
    bal_res = (
        sb.table("dum_transactions")
        .select("balance_after")
        .eq("privy_id", referrer_privy)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    current_balance = bal_res.data[0]["balance_after"] if bal_res.data else 0
    new_balance = current_balance + REFERRAL_REWARD

    sb.table("dum_transactions").insert({
        "privy_id": referrer_privy,
        "amount": REFERRAL_REWARD,
        "reason": "referral_bonus",
        "reference_id": code,
        "balance_after": new_balance,
    }).execute()

    # Also award the new user some welcome points
    new_bal_res = (
        sb.table("dum_transactions")
        .select("balance_after")
        .eq("privy_id", new_user_privy)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    new_user_balance = new_bal_res.data[0]["balance_after"] if new_bal_res.data else 0

    sb.table("dum_transactions").insert({
        "privy_id": new_user_privy,
        "amount": 10,
        "reason": "referral_welcome",
        "reference_id": code,
        "balance_after": new_user_balance + 10,
    }).execute()

    return {"status": "converted", "points_awarded": REFERRAL_REWARD}
