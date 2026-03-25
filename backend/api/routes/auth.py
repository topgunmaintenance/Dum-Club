from typing import Optional
import logging
import os
import traceback

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth.privy import get_current_user
from db.supabase import get_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Auth"])


class WalletInfo(BaseModel):
    address: str
    type: str


class SyncRequest(BaseModel):
    privy_id: str
    email: Optional[str] = None
    embedded_wallet: Optional[str] = None
    linked_wallets: list[WalletInfo] = Field(default_factory=list)
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

        wallet_address = body.embedded_wallet or (
            body.linked_wallets[0].address if body.linked_wallets else None
        )
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
        return (created.data or [{}])[0]
    except HTTPException:
        raise
    except Exception as e:
        # Always log full traceback (stdout + logger — Docker often captures logger better).
        print("AUTH SYNC ERROR:", str(e))
        print("❌ SYNC ERROR:", repr(e))
        traceback.print_exc()
        logger.exception("AUTH SYNC ERROR: %s", e)

        expose = os.getenv("AUTH_SYNC_DETAIL_ERRORS", "0").lower() in (
            "1",
            "true",
            "yes",
        )
        detail = str(e) if expose else "sync_user_failed"
        raise HTTPException(status_code=500, detail=detail)


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
