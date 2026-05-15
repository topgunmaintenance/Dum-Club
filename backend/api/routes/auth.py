from typing import Optional
import traceback

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth.privy import get_current_user
from db.supabase import get_client
from services.seed_claim import maybe_claim_seed_profiles

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class WalletInfo(BaseModel):
    address: str
    type: str


class SyncRequest(BaseModel):
    privy_id: str
    email: Optional[str] = None
    embedded_wallet: Optional[str] = None
    linked_wallets: list[WalletInfo] = []
    google_linked: bool = False


@router.post("/sync")
async def sync_user(body: SyncRequest, current_user: dict = Depends(get_current_user)):
    try:
        print("🔥 SYNC HIT")

        if current_user.get("sub") != body.privy_id:
            raise HTTPException(status_code=403, detail="Token mismatch")

        supabase = get_client()
        existing = (
            supabase.table("users").select("*").eq("privy_id", body.privy_id).execute()
        )

        # Prefer a linked external wallet; fall back to the embedded Privy wallet.
        external_wallet = next(
            (w.address for w in body.linked_wallets if w.type != "privy"),
            None,
        )
        wallet_address = external_wallet or body.embedded_wallet
        wallets = [w.model_dump() for w in body.linked_wallets]

        if existing.data:
            updated = (
                supabase.table("users")
                .update(
                    {
                        "email": body.email,
                        "embedded_wallet": body.embedded_wallet,
                        "linked_wallets": wallets,
                        "google_linked": body.google_linked,
                        "wallet_address": wallet_address,
                    }
                )
                .eq("privy_id", body.privy_id)
                .execute()
            )
            print("✅ SYNC SUCCESS (update)")
            # Auto-claim any seed-sentinel business_profiles whose
            # contact_email matches this user's verified email. No-op
            # if the user has already claimed (owner_privy_id no longer
            # starts with 'seed:') or no match exists.
            try:
                claimed = maybe_claim_seed_profiles(body.privy_id)
                if claimed:
                    print(f"[sync] auto-claimed {claimed} seed profile(s) for {body.privy_id[-6:]}")
            except Exception as claim_exc:
                print(f"[sync] auto-claim failed: {claim_exc!r}")
            return (updated.data or [{}])[0]

        created = (
            supabase.table("users")
            .insert(
                {
                    "privy_id": body.privy_id,
                    "email": body.email,
                    "wallet_address": wallet_address,
                    "embedded_wallet": body.embedded_wallet,
                    "linked_wallets": wallets,
                    "google_linked": body.google_linked,
                    "is_admin": False,
                }
            )
            .execute()
        )
        print("✅ SYNC SUCCESS (insert)")
        # First-time sync — same auto-claim attempt as the update branch.
        try:
            claimed = maybe_claim_seed_profiles(body.privy_id)
            if claimed:
                print(f"[sync] auto-claimed {claimed} seed profile(s) for {body.privy_id[-6:]}")
        except Exception as claim_exc:
            print(f"[sync] auto-claim failed: {claim_exc!r}")
        return (created.data or [{}])[0]
    except HTTPException:
        raise
    except Exception as e:
        print("❌ SYNC ERROR:", repr(e))
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="sync_user_failed")


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    supabase = get_client()
    result = (
        supabase.table("users")
        .select("*")
        .eq("privy_id", current_user.get("sub"))
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return result.data
