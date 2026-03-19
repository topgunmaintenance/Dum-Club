from fastapi import APIRouter, HTTPException
import json
import os
import subprocess
from datetime import datetime, timezone
from db.supabase import get_client

router = APIRouter()

PROJECT_TREASURY_WALLET = os.getenv("PROJECT_TREASURY_WALLET", "").strip()
DUM_TREASURY_WALLET = os.getenv("DUM_TREASURY_WALLET", "").strip()


@router.post("/api/projects/{project_id}/create-token")
async def create_project_token(project_id: str):
    supabase = get_client()

    project_resp = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .execute()
    )

    if not project_resp.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_resp.data[0]

    review_status = project.get("review_status")
    token_name = (project.get("token_name") or "").strip()
    token_symbol = (project.get("token_symbol") or "").strip().upper()
    token_supply = project.get("token_supply")
    token_decimals = project.get("token_decimals") or 9
    existing_mint = project.get("token_mint_address")

    # -----------------------------
    # ENFORCE APPROVAL BEFORE MINT
    # -----------------------------
    if review_status != "approved":
        raise HTTPException(
            status_code=400,
            detail="Project must be approved before mint creation."
        )

    # -----------------------------
    # REQUIRE TOKEN METADATA
    # -----------------------------
    if not token_name or not token_symbol or not token_supply:
        raise HTTPException(
            status_code=400,
            detail="Token metadata is incomplete. token_name, token_symbol, and token_supply are required."
        )

    # -----------------------------
    # PREVENT DUPLICATE MINTS
    # -----------------------------
    if existing_mint:
        raise HTTPException(
            status_code=400,
            detail="Token mint already exists for this project."
        )

    # -----------------------------
    # CREATE MINT
    # -----------------------------
    result = subprocess.run(
        ["node", "scripts/create_project_token.js", "create-mint"],
        cwd="/workspace",
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)

    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid token script output: {result.stdout}"
        )

    mint = output["mintAddress"]

    # -----------------------------
    # UPDATE PROJECT RECORD
    # -----------------------------
    update_resp = (
        supabase.table("projects")
        .update({
            "token_mint_address": mint,
            "review_status": "token_live",
            "token_name": token_name,
            "token_symbol": token_symbol,
            "token_supply": token_supply,
            "token_decimals": token_decimals,
            "token_status": "mint_created",
            "token_created_at": datetime.now(timezone.utc).isoformat()
        })
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "project_id": project_id,
        "mint": mint,
        "token_name": token_name,
        "token_symbol": token_symbol,
        "token_supply": token_supply,
        "token_decimals": token_decimals,
        "token_status": "mint_created",
        "db_updated": bool(update_resp.data)
    }


@router.post("/api/projects/{project_id}/mint-tokens")
async def mint_project_tokens(project_id: str):
    supabase = get_client()

    project_resp = (
        supabase.table("projects")
        .select("*")
        .eq("id", project_id)
        .execute()
    )

    if not project_resp.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_resp.data[0]

    token_name = (project.get("token_name") or "").strip()
    token_symbol = (project.get("token_symbol") or "").strip().upper()
    token_supply = project.get("token_supply")
    token_decimals = project.get("token_decimals") or 9
    mint_address = (project.get("token_mint_address") or "").strip()
    token_status = (project.get("token_status") or "").strip()

    if not token_name or not token_symbol or not token_supply:
        raise HTTPException(
            status_code=400,
            detail="Token metadata is incomplete. token_name, token_symbol, and token_supply are required."
        )

    if not mint_address:
        raise HTTPException(
            status_code=400,
            detail="Mint does not exist yet. Create mint before minting tokens."
        )

    if token_status not in ["mint_created", "tokens_minted"]:
        raise HTTPException(
            status_code=400,
            detail=f"Project token must be in mint_created state before minting. Current state: {token_status or 'unknown'}"
        )

    if not PROJECT_TREASURY_WALLET:
        raise HTTPException(
            status_code=500,
            detail="PROJECT_TREASURY_WALLET is not configured."
        )

    if not DUM_TREASURY_WALLET:
        raise HTTPException(
            status_code=500,
            detail="DUM_TREASURY_WALLET is not configured."
        )

    # 80% to project treasury, 20% to DUM treasury
    project_amount = int(token_supply * 0.80)
    dum_amount = int(token_supply - project_amount)

    result = subprocess.run(
        [
            "node",
            "scripts/create_project_token.js",
            "mint-supply",
            mint_address,
            str(token_supply),
            str(token_decimals),
            PROJECT_TREASURY_WALLET,
            str(project_amount),
            DUM_TREASURY_WALLET,
            str(dum_amount),
        ],
        cwd="/workspace",
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)

    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid token mint script output: {result.stdout}"
        )

    update_resp = (
        supabase.table("projects")
        .update({
            "token_status": "tokens_minted"
        })
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "project_id": project_id,
        "mint": mint_address,
        "token_name": token_name,
        "token_symbol": token_symbol,
        "token_supply": token_supply,
        "token_decimals": token_decimals,
        "project_treasury_wallet": PROJECT_TREASURY_WALLET,
        "project_treasury_amount": project_amount,
        "dum_treasury_wallet": DUM_TREASURY_WALLET,
        "dum_treasury_amount": dum_amount,
        "token_status": "tokens_minted",
        "script_output": output,
        "db_updated": bool(update_resp.data)
    }
