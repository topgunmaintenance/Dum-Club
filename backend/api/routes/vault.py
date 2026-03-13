"""
Vault routes — record SOL vaults (on-chain tx already done on frontend).
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from db.supabase import get_client

router = APIRouter()


class VaultRequest(BaseModel):
    supporter_wallet: str
    creator_wallet:   str
    amount_sol:       float
    tx_signature:     str


class WithdrawRequest(BaseModel):
    supporter_wallet: str
    creator_wallet:   str
    tx_signature:     str


@router.post("/record")
async def record_vault(req: VaultRequest):
    """Called after on-chain vault tx confirmed."""
    client = get_client()

    # Resolve wallet → profile ids
    supporter = await client.table("profiles").select("id").eq("wallet_address", req.supporter_wallet).single().execute()
    creator   = await client.table("profiles").select("id").eq("wallet_address", req.creator_wallet).single().execute()

    if not supporter.data or not creator.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    result = await client.table("vaults").upsert({
        "supporter_id":  supporter.data["id"],
        "creator_id":    creator.data["id"],
        "amount_sol":    req.amount_sol,
        "tx_signature":  req.tx_signature,
        "status":        "active",
    }, on_conflict="supporter_id,creator_id").execute()

    return {"success": True, "vault": result.data}


@router.get("/creator/{wallet}")
async def get_creator_vaults(wallet: str):
    """Total SOL vaulted to a creator + supporter count."""
    client = get_client()
    creator = await client.table("profiles").select("id").eq("wallet_address", wallet).single().execute()
    if not creator.data:
        raise HTTPException(status_code=404, detail="Creator not found")

    vaults = await client.table("vaults")\
        .select("amount_sol, supporter_id")\
        .eq("creator_id", creator.data["id"])\
        .eq("status", "active")\
        .execute()

    total = sum(v["amount_sol"] for v in (vaults.data or []))
    return {
        "creator_wallet":   wallet,
        "total_sol_vaulted": total,
        "supporter_count":  len(vaults.data or []),
    }


@router.get("/supporter/{wallet}")
async def get_supporter_vaults(wallet: str):
    """All creators a supporter has vaulted to."""
    client = get_client()
    supporter = await client.table("profiles").select("id").eq("wallet_address", wallet).single().execute()
    if not supporter.data:
        raise HTTPException(status_code=404, detail="Supporter not found")

    vaults = await client.table("vaults")\
        .select("*, profiles!creator_id(username, display_name, wallet_address)")\
        .eq("supporter_id", supporter.data["id"])\
        .eq("status", "active")\
        .execute()

    return {"vaults": vaults.data}
