from fastapi import APIRouter, HTTPException
import os
import requests
from db.supabase import get_client

router = APIRouter()

SOLANA_RPC_URL = os.getenv(
    "SOLANA_RPC_URL",
    "https://api.mainnet-beta.solana.com",
)


def rpc_call(method: str, params: list):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    }

    response = requests.post(SOLANA_RPC_URL, json=payload, timeout=20)
    response.raise_for_status()
    data = response.json()

    if "error" in data:
        raise HTTPException(status_code=400, detail=data["error"])

    return data.get("result")


@router.get("/projects/{project_id}/token-metadata")
def get_project_token_metadata(project_id: str):
    client = get_client()

    project_res = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .single()
        .execute()
    )

    project = project_res.data

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    mint_address = project.get("token_mint_address")

    token_name = (
        project.get("token_name")
        or project.get("title")
        or project.get("name")
        or "Unknown Token"
    )

    token_symbol = project.get("token_symbol") or ""
    db_supply = project.get("token_supply")
    db_decimals = project.get("token_decimals")

    # -----------------------------
    # STATUS 1 — PROJECT DRAFT
    # -----------------------------
    if not mint_address:
        return {
            "mint_address": None,
            "name": token_name,
            "symbol": token_symbol,
            "supply": db_supply,
            "decimals": db_decimals,
            "status": "draft",
        }

    # -----------------------------
    # FETCH TOKEN SUPPLY
    # -----------------------------
    token_supply = rpc_call("getTokenSupply", [mint_address])

    decimals = db_decimals
    supply = db_supply

    if token_supply and token_supply.get("value"):
        decimals = token_supply["value"].get("decimals", db_decimals)
        supply = token_supply["value"].get("uiAmount", db_supply)

    # -----------------------------
    # TOKEN LIFECYCLE STATUS ENGINE
    # -----------------------------
    # draft -> mint_created -> tokens_minted
    # liquidity_added and trading_live will be added later

    if supply is None:
        status = "mint_created"
    elif supply == 0:
        status = "mint_created"
    else:
        status = "tokens_minted"

    return {
        "mint_address": mint_address,
        "name": token_name,
        "symbol": token_symbol,
        "supply": supply,
        "decimals": decimals,
        "status": status,
    }
