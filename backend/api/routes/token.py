from fastapi import APIRouter, HTTPException
import os
import json
import subprocess
import uuid
from datetime import datetime, timezone
from db.supabase import get_client

router = APIRouter()

PROJECT_TREASURY_WALLET = os.getenv("PROJECT_TREASURY_WALLET", "").strip()
DUM_TREASURY_WALLET = os.getenv("DUM_TREASURY_WALLET", "").strip()
TOKEN_LIFECYCLE = ["draft", "mint_created", "tokens_minted", "liquidity_added", "trading_live"]

# Legacy / UI values that are not part of the launch sequence — map onto canonical lifecycle.
# Prefer one-time DB cleanup (see backend/db/migrations/002_normalize_legacy_token_status.sql);
# keep this map as a safety net until legacy rows are gone.
TOKEN_STATUS_NORMALIZE = {
    "active": "draft",
    "pending": "draft",
}


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

    raw_status = (project.get("token_status") or "").strip()
    canonical_status = TOKEN_STATUS_NORMALIZE.get(raw_status, raw_status) or "draft"
    if canonical_status != "draft":
        raise HTTPException(
            status_code=400,
            detail=f"Token lifecycle has already started (status: {raw_status!r}). Cannot create a second token."
        )

    # -----------------------------
    # CREATE MINT (simulated)
    # -----------------------------
    # Real on-chain minting requires Node.js + a funded Solana keypair.
    # Until that runtime is provisioned, generate a deterministic placeholder
    # so the token lifecycle can advance through the UI.
    # Replace this block with the subprocess.run call once ready.
    mint = "SIM_" + uuid.uuid4().hex[:24].upper()

    # -----------------------------
    # UPDATE PROJECT RECORD
    # -----------------------------
    update_resp = (
        supabase.table("projects")
        .update({
            "token_mint_address": mint,
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
    raw_status = (project.get("token_status") or "").strip()
    token_status = _canonical_token_status(raw_status)

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
            detail=(
                f"Project token must be in mint_created state before minting. "
                f"Current (raw={raw_status!r}, canonical={token_status!r})"
            ),
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


def _canonical_token_status(raw: str) -> str:
    """Map DB/UI token_status onto TOKEN_LIFECYCLE for advancement logic."""
    key = (raw or "").strip()
    if not key:
        return "draft"
    if key in TOKEN_STATUS_NORMALIZE:
        return TOKEN_STATUS_NORMALIZE[key]
    return key


@router.post("/api/projects/{project_id}/advance-token-status")
async def advance_token_status(project_id: str):
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
    raw = (project.get("token_status") or "").strip()

    if raw == "rejected":
        raise HTTPException(
            status_code=400,
            detail="Cannot advance token status: token lifecycle is rejected for this project.",
        )

    current = _canonical_token_status(raw)

    if current not in TOKEN_LIFECYCLE:
        expected = ", ".join(TOKEN_LIFECYCLE)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot advance token status from {raw!r}. "
                f"Expected one of: {expected}. "
                f"Legacy values active and pending are treated as draft."
            ),
        )

    if current == "trading_live":
        raise HTTPException(
            status_code=400,
            detail="Token is already at trading_live; nothing to advance.",
        )

    next_status = TOKEN_LIFECYCLE[TOKEN_LIFECYCLE.index(current) + 1]
    update_data = {"token_status": next_status}

    if next_status == "trading_live":
        update_data["status"] = "live"

    update_resp = (
        supabase.table("projects")
        .update(update_data)
        .eq("id", project_id)
        .execute()
    )

    return {
        "status": "success",
        "project_id": project_id,
        "previous_token_status_raw": raw or None,
        "previous_token_status": current,
        "token_status": next_status,
        "project_status": update_data.get("status", project.get("status")),
        "db_updated": bool(update_resp.data),
    }
