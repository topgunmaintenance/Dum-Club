"""
IVS Real-Time — API routes for stage and token management.

Endpoints:
  POST /api/ivs/create-stage    — Owner creates a stage for their project
  POST /api/ivs/host-token      — Owner gets a PUBLISH token
  POST /api/ivs/viewer-token    — Viewer gets a SUBSCRIBE token
  POST /api/ivs/end-stage       — Owner ends/deletes a stage
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from services.ivs_realtime import is_ivs_enabled, create_stage, create_participant_token, delete_stage

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────

def _verify_owner(project_id: str, user_id: str) -> dict:
    """Verify user is the project owner. Returns project data."""
    from api.routes.projects import _resolve_owner_uuid
    supabase = get_client()
    res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id, is_live, ivs_stage_arn")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = res.data[0]
    resolved = _resolve_owner_uuid(supabase, user_id)
    owner_match = (
        (project.get("owner_id") and project["owner_id"] == user_id)
        or (project.get("owner_id") and resolved and project["owner_id"] == resolved)
        or (project.get("privy_id") and project["privy_id"] == user_id)
    )
    if not owner_match:
        raise HTTPException(status_code=403, detail="Not project owner")
    return project


def _require_ivs():
    if not is_ivs_enabled():
        raise HTTPException(
            status_code=503,
            detail="IVS Real-Time is not enabled. Set ENABLE_IVS_REALTIME_BACKEND=true and AWS credentials."
        )


# ── Models ───────────────────────────────────────────────────

class CreateStageRequest(BaseModel):
    project_id: str


class TokenRequest(BaseModel):
    project_id: str


class EndStageRequest(BaseModel):
    project_id: str


# ── Create Stage ─────────────────────────────────────────────

@router.post("/create-stage")
async def api_create_stage(
    body: CreateStageRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner creates an IVS Real-Time stage for their project."""
    _require_ivs()
    project = _verify_owner(body.project_id, user_id)

    # If stale stage exists, clean it up first
    old_arn = project.get("ivs_stage_arn")
    if old_arn:
        print(f"[ivs] Cleaning up stale stage: {old_arn}")
        delete_stage(old_arn)
        supabase_client = get_client()
        supabase_client.table("projects").update({
            "ivs_stage_arn": None,
            "ivs_stage_id": None,
            "is_live": False,
        }).eq("id", body.project_id).execute()
        import asyncio
        await asyncio.sleep(1.0)  # Allow AWS to propagate deletion
        print(f"[ivs] Stale stage cleaned, creating fresh")

    # Create fresh stage
    stage_name = f"dum-club-{body.project_id[:8]}"
    stage_data = create_stage(stage_name)
    if not stage_data:
        raise HTTPException(status_code=502, detail="Failed to create IVS stage")

    fresh_arn = stage_data["stage_arn"]
    print(f"[ivs] Fresh stage created: {fresh_arn}")

    # Store stage ARN on project
    supabase = get_client()
    supabase.table("projects").update({
        "ivs_stage_arn": fresh_arn,
        "ivs_stage_id": stage_data["stage_id"],
        "live_provider": "ivs_realtime",
        "is_live": True,
    }).eq("id", body.project_id).execute()

    # Generate host token using the FRESH ARN
    print(f"[ivs] Minting host PUBLISH token for stage: {fresh_arn}")
    host_token = create_participant_token(
        stage_arn=fresh_arn,
        user_id=user_id,
        role="PUBLISHER",
    )
    print(f"[ivs] Host token created: has_token={bool(host_token)}")

    return {
        "status": "success",
        "stage_arn": stage_data["stage_arn"],
        "stage_id": stage_data["stage_id"],
        "host_token": host_token["token"] if host_token else None,
        "participant_id": host_token["participant_id"] if host_token else None,
    }


# ── Host Token ───────────────────────────────────────────────

@router.post("/host-token")
async def api_host_token(
    body: TokenRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner gets a PUBLISH participant token for their project's stage."""
    _require_ivs()
    project = _verify_owner(body.project_id, user_id)

    stage_arn = project.get("ivs_stage_arn")
    if not stage_arn:
        raise HTTPException(status_code=404, detail="No active stage for this project")

    token_data = create_participant_token(
        stage_arn=stage_arn,
        user_id=user_id,
        role="PUBLISHER",
    )
    if not token_data:
        raise HTTPException(status_code=502, detail="Failed to create host token")

    return {
        "status": "success",
        "token": token_data["token"],
        "participant_id": token_data["participant_id"],
    }


# ── Viewer Token ─────────────────────────────────────────────

@router.post("/viewer-token")
async def api_viewer_token(
    body: TokenRequest,
    user_id: str = Header(default="", convert_underscores=False),
):
    """Viewer gets a SUBSCRIBE participant token for a project's stage."""
    _require_ivs()
    supabase = get_client()

    res = (
        supabase.table("projects")
        .select("id, ivs_stage_arn, is_live")
        .eq("id", body.project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = res.data[0]
    if not project.get("is_live") or not project.get("ivs_stage_arn"):
        raise HTTPException(status_code=404, detail="No active live session")

    viewer_id = user_id or f"anon-{body.project_id[:8]}"
    token_data = create_participant_token(
        stage_arn=project["ivs_stage_arn"],
        user_id=viewer_id,
        role="SUBSCRIBER",
    )
    if not token_data:
        raise HTTPException(status_code=502, detail="Failed to create viewer token")

    return {
        "status": "success",
        "token": token_data["token"],
        "participant_id": token_data["participant_id"],
        "stage_arn": project["ivs_stage_arn"],
    }


# ── End Stage ────────────────────────────────────────────────

@router.post("/end-stage")
async def api_end_stage(
    body: EndStageRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner ends the live session and deletes the IVS stage."""
    _require_ivs()
    project = _verify_owner(body.project_id, user_id)

    stage_arn = project.get("ivs_stage_arn")
    if stage_arn:
        delete_stage(stage_arn)

    # Clear live state
    supabase = get_client()
    supabase.table("projects").update({
        "is_live": False,
        "ivs_stage_arn": None,
        "ivs_stage_id": None,
        "live_provider": None,
        "stream_url": None,
        "pinned_offer_id": None,
        "live_playback_id": None,
        "live_stream_id": None,
        "live_stream_key": None,
        "live_ingest_url": None,
    }).eq("id", body.project_id).execute()

    return {"status": "success", "is_live": False}
