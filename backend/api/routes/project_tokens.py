from fastapi import APIRouter, HTTPException
import os
import requests
from db.supabase import get_client
from services.token_mode import is_simulated_token, token_mode

router = APIRouter()

# Align API responses with TOKEN_LIFECYCLE in token.py (legacy DB values).
_TOKEN_STATUS_DISPLAY = {"active": "draft", "pending": "draft"}

SOLANA_RPC_URL = os.getenv(
    "SOLANA_RPC_URL",
    "https://api.devnet.solana.com",
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


@router.get("/sol-balance/{address}")
def get_sol_balance(address: str):
    result = rpc_call("getBalance", [address])
    lamports = result.get("value", 0) if isinstance(result, dict) else 0
    return {"address": address, "lamports": lamports, "sol": round(lamports / 1e9, 9)}


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
    raw_ts = (project.get("token_status") or "").strip() or "draft"
    project_token_status = _TOKEN_STATUS_DISPLAY.get(raw_ts, raw_ts)

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
            "status": project_token_status,
            # No mint yet — treated as simulated for honesty purposes so
            # nothing downstream advertises a live token that doesn't exist.
            "is_simulated": True,
            "token_mode": "simulated",
            "simulated": True,
        }

    # -----------------------------
    # STATUS 2 — SIMULATED MINT
    # -----------------------------
    if is_simulated_token(mint_address):
        return {
            "mint_address": mint_address,
            "name": token_name,
            "symbol": token_symbol,
            "supply": db_supply,
            "decimals": db_decimals or 9,
            "status": project_token_status,
            # Historical field — kept for back-compat. Prefer is_simulated.
            "simulated": True,
            "is_simulated": True,
            "token_mode": "simulated",
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

    derived_status = "tokens_minted" if supply else "mint_created"
    status = project_token_status or derived_status

    return {
        "mint_address": mint_address,
        "name": token_name,
        "symbol": token_symbol,
        "supply": supply,
        "decimals": decimals,
        "status": status,
        # Real mint path — by definition not simulated.
        "is_simulated": False,
        "token_mode": "on_chain",
    }
