from fastapi import APIRouter, HTTPException
import subprocess
import json
from datetime import datetime, timezone
from db.supabase import get_client

router = APIRouter()


def build_token_symbol(title: str) -> str:
    cleaned = "".join(ch for ch in title.upper() if ch.isalnum())
    return (cleaned[:6] or "DUMAI")


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

    if project.get("review_status") != "approved":
        raise HTTPException(status_code=400, detail="Project not approved")

    if project.get("token_mint_address"):
        raise HTTPException(status_code=400, detail="Token already exists")

    title = (project.get("title") or "DUM Project").strip()
    token_name = title
    token_symbol = build_token_symbol(title)
    token_decimals = 9

    result = subprocess.run(
        ["node", "scripts/create_project_token.js"],
        cwd="/workspace",
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr)

    try:
        output = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail=f"Invalid token script output: {result.stdout}")

    mint = output["mintAddress"]

    update_resp = (
        supabase.table("projects")
        .update({
            "token_mint_address": mint,
            "review_status": "token_live",
            "token_name": token_name,
            "token_symbol": token_symbol,
            "token_decimals": token_decimals,
            "token_status": "live",
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
        "token_decimals": token_decimals,
        "db_updated": bool(update_resp.data)
    }
