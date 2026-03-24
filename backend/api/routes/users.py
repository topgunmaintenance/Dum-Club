"""Users / profile routes."""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.supabase import get_client

router = APIRouter()


class ProfileUpsert(BaseModel):
    wallet_address: str
    username:       Optional[str] = None
    display_name:   Optional[str] = None
    bio:            Optional[str] = None
    avatar_url:     Optional[str] = None


@router.post("/profile")
async def upsert_profile(req: ProfileUpsert):
    client = get_client()
    result = await client.table("profiles").upsert(
        req.model_dump(exclude_none=False),
        on_conflict="wallet_address"
    ).execute()
    return {"profile": result.data[0]}


@router.get("/profile/{wallet}")
async def get_profile(wallet: str):
    client = get_client()
    result = await client.table("profiles").select("*").eq("wallet_address", wallet).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {"profile": result.data}
