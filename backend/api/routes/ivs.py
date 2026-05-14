"""
IVS Real-Time — API routes for stage and token management.

Endpoints:
  POST /api/ivs/create-stage    — Owner creates a stage for their project
  POST /api/ivs/host-token      — Owner gets a PUBLISH token
  POST /api/ivs/viewer-token    — Viewer gets a SUBSCRIBE token
  POST /api/ivs/end-stage       — Owner ends/deletes a stage
"""
import asyncio
import time as _time

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from services.ivs_realtime import is_ivs_enabled, create_stage, create_participant_token, delete_stage
from services.live_limits import (
    register_stream_start,
    clear_stream,
    check_join_rate,
    add_viewer,
    remove_viewer,
    record_heartbeat,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────

def _verify_owner(project_id: str, user_id: str) -> dict:
    """Verify user is the project owner. Returns project data.

    Accepts either a project UUID or a slug as `project_id` — frontend
    routes like /project/[id] forward the URL param verbatim, which is
    a slug on user-facing URLs (e.g. /project/topgun-maintenance).
    """
    from api.routes.projects import _resolve_owner_uuid, resolve_project_uuid
    supabase = get_client()
    resolved_uuid = resolve_project_uuid(supabase, project_id)
    if not resolved_uuid:
        raise HTTPException(status_code=404, detail="Project not found")
    res = (
        supabase.table("projects")
        .select("id, owner_id, privy_id, is_live, ivs_stage_arn")
        .eq("id", resolved_uuid)
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


class HeartbeatRequest(BaseModel):
    project_id: str


# ── Heartbeat ────────────────────────────────────────────────

@router.post("/heartbeat")
async def api_heartbeat(
    body: HeartbeatRequest,
    user_id: str = Header(default="", convert_underscores=False),
):
    """Host posts every ~5s while broadcasting. Updates the
    in-memory last-heartbeat timestamp so on-read endpoints can
    detect "host went away" within ~15s and flip is_live=false
    in the DB (see services/live_limits.HEARTBEAT_STALE_AFTER_SECONDS).

    Owner check matches the rest of /api/ivs/*: a misbehaving
    third party can't keep a stream artificially "alive" by
    pinging this endpoint for someone else's project.

    Cheap path: in-memory dict write, no DB call, no AWS call.
    Designed for 5-second cadence × N concurrent hosts.
    """
    _require_ivs()
    project = _verify_owner(body.project_id, user_id)
    record_heartbeat(project["id"])
    return {"status": "ok"}


# ── Create Stage ─────────────────────────────────────────────

@router.post("/create-stage")
async def api_create_stage(
    body: CreateStageRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner creates an IVS Real-Time stage for their project."""
    _require_ivs()
    project = _verify_owner(body.project_id, user_id)

    # Canonical UUID — every DB write and live-limit key from here on
    # must use this, NOT body.project_id, which may be a slug. The
    # previous version mixed both: _verify_owner resolved correctly,
    # but the subsequent .eq("id", body.project_id) UPDATEs silently
    # matched zero rows on slug input, so AWS would create a stage
    # but the DB never recorded ivs_stage_arn / is_live=True. Viewers
    # then 404'd at /viewer-token's "No active live session" gate.
    project_uuid = project["id"]

    # Check daily stream limit
    limit_err = register_stream_start(project_uuid, user_id)
    if limit_err:
        raise HTTPException(status_code=429, detail=limit_err)

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
        }).eq("id", project_uuid).execute()
        await asyncio.sleep(1.0)  # Allow AWS to propagate deletion
        print(f"[ivs] Stale stage cleaned, creating fresh")

    # Create fresh stage. Use the canonical UUID prefix in the name
    # so two projects with similar slugs don't collide on stage name.
    stage_name = f"dum-club-{project_uuid[:8]}"
    stage_data = create_stage(stage_name)
    if not stage_data:
        raise HTTPException(status_code=502, detail="Failed to create IVS stage")

    fresh_arn = stage_data["stage_arn"]
    fresh_id = stage_data["stage_id"]
    create_ts = _time.time()
    print(f"[ivs] Fresh stage created: arn={fresh_arn} id={fresh_id} at={create_ts:.3f}")

    # Store stage ARN on project — keyed by canonical UUID.
    supabase = get_client()
    supabase.table("projects").update({
        "ivs_stage_arn": fresh_arn,
        "ivs_stage_id": fresh_id,
        "live_provider": "ivs_realtime",
        "is_live": True,
    }).eq("id", project_uuid).execute()
    print(f"[ivs] DB updated with fresh ARN for project={project_uuid}")

    # Wait for AWS to fully propagate the new stage before minting tokens
    await asyncio.sleep(1.0)
    mint_ts = _time.time()
    print(f"[ivs] Waited {mint_ts - create_ts:.1f}s before token mint")

    # Generate host token using the FRESH ARN — hard validation
    print(f"[ivs] Minting host PUBLISH token for stage: {fresh_arn}")
    host_token = create_participant_token(
        stage_arn=fresh_arn,
        user_id=user_id,
        role="PUBLISHER",
    )

    # Hard assertion: token was minted for the right stage
    if host_token:
        print(f"[ivs] VALIDATION: fresh_arn={fresh_arn}, token_minted=True, participant={host_token.get('participant_id')}")
    else:
        print(f"[ivs] VALIDATION: fresh_arn={fresh_arn}, token_minted=False — PUBLISH TOKEN FAILED")

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
    """Viewer gets a SUBSCRIBE participant token for a project's stage.

    Accepts either a project UUID or slug as body.project_id — same reasoning
    as _verify_owner. Once resolved, all downstream keying (viewer-count
    bucket, anon viewer id, log lines) uses the canonical UUID so two
    viewers on the slug URL and the UUID URL of the same project share one
    bucket instead of being split.
    """
    _require_ivs()

    supabase = get_client()
    from api.routes.projects import resolve_project_uuid
    resolved_uuid = resolve_project_uuid(supabase, body.project_id)
    if not resolved_uuid:
        raise HTTPException(status_code=404, detail="Project not found")

    # Rate limit joins
    viewer_id = user_id or f"anon-{resolved_uuid[:8]}"
    join_err = check_join_rate(viewer_id)
    if join_err:
        raise HTTPException(status_code=429, detail=join_err)

    # Check viewer capacity (keyed on canonical UUID)
    viewer_err = add_viewer(resolved_uuid)
    if viewer_err:
        raise HTTPException(status_code=503, detail=viewer_err)

    res = (
        supabase.table("projects")
        .select("id, ivs_stage_arn, is_live")
        .eq("id", resolved_uuid)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = res.data[0]
    if not project.get("is_live") or not project.get("ivs_stage_arn"):
        raise HTTPException(status_code=404, detail="No active live session")

    viewer_id = user_id or f"anon-{resolved_uuid[:8]}"
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

    # Same canonical-UUID discipline as create-stage: every DB write
    # and live-limit key uses project["id"], not body.project_id.
    project_uuid = project["id"]

    stage_arn = project.get("ivs_stage_arn")
    if stage_arn:
        delete_stage(stage_arn)

    # Clear limits tracking — keyed on the same UUID register_stream_start
    # used, so the daily-limit counter actually decrements.
    clear_stream(project_uuid)

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
    }).eq("id", project_uuid).execute()

    return {"status": "success", "is_live": False}
