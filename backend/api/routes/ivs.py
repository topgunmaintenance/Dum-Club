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

from fastapi import APIRouter, HTTPException, Header, Request, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from services.ivs_realtime import (
    is_ivs_enabled,
    is_recording_enabled,
    is_showcase_upload_enabled,
    create_stage,
    create_participant_token,
    delete_stage,
    find_latest_recording,
    delete_recording_prefix,
    create_showcase_upload_url,
    head_object_size,
    delete_object,
    public_url_for_key,
    SHOWCASE_MAX_BYTES,
    SHOWCASE_CONTENT_TYPES,
)
from services.live_limits import (
    register_stream_start,
    clear_stream,
    check_join_rate,
    add_viewer,
    remove_viewer,
    record_heartbeat,
    client_ip_from_request,
    enforce_rate_limit,
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
    # Optional caller context tag (e.g. "homepage_preview") so future
    # metering can distinguish preview joins from full watch-view joins.
    # Accepted and logged only - NO enforcement reads it and nothing is
    # persisted (no schema change). Declared explicitly so a tagged
    # request can never 422 on an unknown field.
    context: Optional[str] = None


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

    Also persists projects.last_heartbeat_at on every poll so
    stale-detection survives a Railway restart that wipes the
    in-memory dict. The DB write is wrapped so a transient
    failure cannot block heartbeat acknowledgment.
    """
    _require_ivs()
    project = _verify_owner(body.project_id, user_id)
    project_id = project["id"]
    record_heartbeat(project_id)
    try:
        from datetime import datetime, timezone
        get_client().table("projects").update({
            "last_heartbeat_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", project_id).execute()
    except Exception as exc:
        print(f"[ivs] heartbeat DB persist failed for {project_id}: {exc!r}")
    return {"status": "ok"}


# ── Live preview snapshot ────────────────────────────────────

# Cap the snapshot upload. The host sends a ~320px JPEG, which is a few
# tens of KB; 1MB is a generous ceiling that still rejects anything that
# isn't a small preview frame.
_MAX_LIVE_THUMB_BYTES = 1_000_000


@router.post("/live-thumb")
async def api_live_thumb(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    user_id: str = Header(default="", convert_underscores=False),
):
    """Host posts a small JPEG frame of the live camera every ~10s.

    Stored at a deterministic path (live-thumbs/<project_id>.jpg) in the
    existing public `offers` bucket, so the Discover "Live now" card can
    show a real preview frame WITHOUT subscribing to the WebRTC stage and
    WITHOUT a new DB column / migration — the path is derived from the
    project id and the card cache-busts on its own. Upsert keeps a single
    current frame per shop.

    Owner-gated like the rest of /api/ivs/*, and only accepted while the
    project is actually live so a stray upload after End Stream can't
    resurrect a preview.
    """
    project = _verify_owner(project_id, user_id)
    pid = project["id"]
    if not project.get("is_live"):
        raise HTTPException(status_code=409, detail="Project is not live")

    content_type = (file.content_type or "").lower()
    if content_type not in ("image/jpeg", "image/jpg", "image/webp", "image/png"):
        raise HTTPException(status_code=400, detail="Snapshot must be a JPEG, PNG, or WebP image")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty snapshot")
    if len(contents) > _MAX_LIVE_THUMB_BYTES:
        raise HTTPException(status_code=413, detail="Snapshot too large")

    supabase = get_client()
    path = f"live-thumbs/{pid}.jpg"
    try:
        supabase.storage.from_("offers").upload(
            path=path,
            file=contents,
            file_options={
                "content-type": content_type,
                # Short cache so the refreshing preview doesn't get pinned
                # stale at the CDN; the card also cache-busts with a query.
                "cache-control": "5",
                "upsert": "true",
            },
        )
    except Exception as exc:
        print(f"[ivs] live-thumb upload failed for {pid}: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail="Snapshot upload failed")

    public_url = supabase.storage.from_("offers").get_public_url(path)
    return {"public_url": public_url, "path": path}


# ── Create Stage ─────────────────────────────────────────────

@router.post("/create-stage")
async def api_create_stage(
    body: CreateStageRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner creates an IVS Real-Time stage for their project."""
    _require_ivs()

    # Overlap the project-owner verification + merchant suspension check.
    # Both are independent SELECTs against Supabase. supabase-py is
    # synchronous, so push each into a thread and gather. Mirrors the
    # parallelization PR #228 shipped for the Mux /go-live handler.
    # Saves ~100–300 ms off the perceived-latency budget for every
    # IVS Go Live. _verify_owner raises HTTPException on miss; gather
    # re-raises (default behavior) → same auth semantics as the prior
    # sequential code.
    from api.routes.merchant import is_merchant_suspended

    project, suspended = await asyncio.gather(
        asyncio.to_thread(_verify_owner, body.project_id, user_id),
        asyncio.to_thread(is_merchant_suspended, user_id),
    )

    # Suspension gate (Phase 2 grace-period rollout). Suspended merchants
    # keep dashboard access so they can update their card, but cannot
    # start new broadcasts. Plain-English 402 detail mirrors the banner
    # copy so the frontend can surface it verbatim.
    #
    # Identity correction (payment-gate fix, 2026-07-31): the parallel
    # check above keys off the raw user_id header, but _verify_owner
    # also authorizes via the owner_id UUID branch — in that case
    # merchants.owner_privy_id lookup on the UUID finds no row and the
    # gate silently passes. Re-check against the project's canonical
    # privy DID whenever it differs, mirroring projects.py go_live.
    owner_privy_for_gate = project.get("privy_id") or user_id
    if not suspended and owner_privy_for_gate != user_id:
        suspended = await asyncio.to_thread(
            is_merchant_suspended, owner_privy_for_gate
        )
    if suspended:
        raise HTTPException(
            status_code=402,
            detail="Your shop is paused. Update your payment method to go live.",
        )

    # Canonical UUID — every DB write and live-limit key from here on
    # must use this, NOT body.project_id, which may be a slug. The
    # previous version mixed both: _verify_owner resolved correctly,
    # but the subsequent .eq("id", body.project_id) UPDATEs silently
    # matched zero rows on slug input, so AWS would create a stage
    # but the DB never recorded ivs_stage_arn / is_live=True. Viewers
    # then 404'd at /viewer-token's "No active live session" gate.
    project_uuid = project["id"]

    # Phase 1 cap enforcement: resolve the merchant's per-tier limits.
    # Resolver fails closed on any unresolved NULL cap (Business / Enterprise
    # without an override) — that's doctrine per migration 049. The
    # max_concurrent_streams CHECK happens after the stale-stage cleanup
    # below so re-go-live on the same project doesn't count itself toward
    # the cap.
    supabase_client = get_client()
    owner_privy_for_limits = project.get("privy_id") or user_id

    # Stripe-Connect gate — a merchant must be able to ACCEPT payments
    # before they can broadcast. Going live burns AWS IVS viewer-hours
    # (real cost to DUM Club); letting a merchant with no Stripe Connect
    # go live is pure cost with zero possible revenue — no checkout, so no
    # 1.5% sales fee. The Mux /go-live path already enforced this; the IVS
    # create-stage path did not, so a direct call bypassed it (the
    # frontend only hid the button). Mirror the Mux gate exactly so the
    # rule holds on every go-live path: Stripe-verified merchants go live,
    # everyone else is routed to finish Stripe onboarding.
    stripe_status_res = (
        supabase_client.table("merchants")
        .select("stripe_connect_status")
        .eq("owner_privy_id", owner_privy_for_limits)
        .limit(1)
        .execute()
    )
    merchant_stripe_status = (
        stripe_status_res.data[0].get("stripe_connect_status")
        if stripe_status_res.data else None
    )
    if merchant_stripe_status != "verified":
        print(
            f"[ivs] Refusing create-stage: project={project_uuid} "
            f"merchant={owner_privy_for_limits} "
            f"stripe_connect_status={merchant_stripe_status!r}"
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "merchant_stripe_not_verified",
                "message": (
                    "Stripe onboarding is not complete yet. "
                    "Finish Stripe verification before going live."
                ),
            },
        )

    from services.merchant_limits import (
        resolve_merchant_limits_by_privy_did,
        check_monthly_hard_block,
        MerchantLimitsUnresolved,
    )
    try:
        limits = resolve_merchant_limits_by_privy_did(
            owner_privy_for_limits, supabase=supabase_client,
        )
    except MerchantLimitsUnresolved as exc:
        print(f"[ivs] cap-resolve refused: {exc!r}")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "merchant_limits_unresolved",
                "message": (
                    "Live setup is still finishing for your account. "
                    "Please try again in a moment."
                ),
                "reason": exc.reason,
            },
        )

    # Phase 3a: monthly hard-block check. Refuse new streams when this
    # merchant has burned through hard_block_multiplier × included_vh
    # this month. Telemetry-read failures fall OPEN (returns None) so
    # we don't refuse every go-live on a Supabase hiccup.
    hard_block_reason = check_monthly_hard_block(limits, supabase=supabase_client)
    if hard_block_reason:
        print(f"[ivs] monthly hard block triggered: {hard_block_reason}")
        raise HTTPException(
            status_code=429,
            detail={
                "code": "monthly_hard_block",
                "message": (
                    f"You've exceeded the {limits.plan_id} plan's hard-cap monthly "
                    f"viewer-hours. Upgrade your plan or wait until next month to go live again."
                ),
                "tier": limits.plan_id,
                "included_vh": float(limits.max_monthly_viewer_hours),
                "hard_block_multiplier": float(limits.hard_block_multiplier),
                "upgrade_url": "/upgrade",
            },
        )

    # If stale stage exists, clean it up first — including closing any
    # active stream_sessions row so the max_concurrent_streams check
    # below sees an accurate count. Without this on_stream_end call,
    # re-going-live on the same project would always trip the cap.
    old_arn = project.get("ivs_stage_arn")
    if old_arn:
        print(f"[ivs] Cleaning up stale stage: {old_arn}")
        delete_stage(old_arn)
        try:
            from services.stream_telemetry import on_stream_end as _on_end
            _on_end(supabase_client, project_uuid, "stale_stage_replaced")
        except Exception as exc:
            print(f"[ivs] on_stream_end during stale cleanup failed: {exc!r}")
        supabase_client.table("projects").update({
            "ivs_stage_arn": None,
            "ivs_stage_id": None,
            "is_live": False,
        }).eq("id", project_uuid).execute()
        await asyncio.sleep(1.0)  # Allow AWS to propagate deletion
        print(f"[ivs] Stale stage cleaned, creating fresh")

    # max_concurrent_streams gate: COUNT(stream_sessions WHERE
    # merchant_id = limits.merchant_id AND end_at IS NULL). Runs AFTER
    # the stale-stage cleanup so a re-go-live on the same project
    # doesn't count its own prior abandoned session.
    try:
        active_streams_res = (
            supabase_client.table("stream_sessions")
            .select("id", count="exact", head=True)
            .eq("merchant_id", limits.merchant_id)
            .is_("end_at", "null")
            .execute()
        )
        active_stream_count = active_streams_res.count or 0
    except Exception as exc:
        # Telemetry-table read failures fail open here — refusing every
        # go-live on a transient Supabase hiccup is worse than the
        # over-stream risk, given the in-memory daily-stream cap and
        # the duration cap downstream both still apply. Logged loudly
        # so operator notices.
        print(f"[ivs] active-stream-count read failed for merchant={limits.merchant_id}: {exc!r}")
        active_stream_count = 0
    if active_stream_count >= limits.max_concurrent_streams:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "concurrent_stream_cap_reached",
                "message": (
                    f"You already have {active_stream_count} live stream(s) running. "
                    f"Your {limits.plan_id} plan allows up to "
                    f"{limits.max_concurrent_streams} concurrent stream(s)."
                ),
                "tier": limits.plan_id,
                "current": active_stream_count,
                "cap": limits.max_concurrent_streams,
                "upgrade_url": "/upgrade",
            },
        )

    # Legacy in-memory daily-stream / global cap (live_limits.py) stays
    # as a belt-and-suspenders. Catches the case where stream_sessions
    # writes are silently failing AND the per-tier check above also
    # under-counts.
    limit_err = register_stream_start(project_uuid, user_id)
    if limit_err:
        raise HTTPException(status_code=429, detail=limit_err)

    # Create fresh stage. Use the canonical UUID prefix in the name
    # so two projects with similar slugs don't collide on stage name.
    stage_name = f"dum-club-{project_uuid[:8]}"
    # Replay recording opt-in (replay-recording-infra, 2026-07-06):
    # record the host only when the merchant flipped "loop my last
    # show" (live_replays.enabled) AND the operator armed recording
    # (env flag + storage config). Best-effort read — a missing table
    # or row means no recording, exactly like before this feature.
    record_this_show = False
    if is_recording_enabled():
        try:
            replay_row = (
                get_client().table("live_replays")
                .select("enabled")
                .eq("project_id", project_uuid)
                .limit(1)
                .execute()
            )
            record_this_show = bool(replay_row.data and replay_row.data[0].get("enabled"))
        except Exception as exc:
            print(f"[ivs] replay opt-in read failed (recording off): {exc!r}")
    stage_data = create_stage(stage_name, record=record_this_show)
    if not stage_data:
        raise HTTPException(status_code=502, detail="Failed to create IVS stage")

    fresh_arn = stage_data["stage_arn"]
    fresh_id = stage_data["stage_id"]
    create_ts = _time.time()
    print(f"[ivs] Fresh stage created: arn={fresh_arn} id={fresh_id} at={create_ts:.3f}")

    # Store stage ARN on project — keyed by canonical UUID. Bump
    # updated_at so the startup sweep's NULL-heartbeat / old-updated_at
    # heuristic doesn't clip this brand-new stream during the 5s window
    # before the first /heartbeat poll persists last_heartbeat_at.
    from datetime import datetime, timezone
    supabase = get_client()

    go_live_update = {
        "ivs_stage_arn": fresh_arn,
        "ivs_stage_id": fresh_id,
        "live_provider": "ivs_realtime",
        "is_live": True,
        # Real broadcast start (migration 084) — drives LiveRail most-recently-
        # live ordering + the storefront "Live for H:MM" timer. Set on every
        # go-live; not cleared on end (the next go-live overwrites it).
        "live_started_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Auto-pin an offer on go-live so the embed always has a one-tap buy.
    # The embed's Buy button renders ONLY when projects.pinned_offer_id is
    # set (frontend/app/embed/[businessId]/page.tsx derives pinnedOffer
    # solely from it). A merchant who added offers but never pinned one
    # would broadcast with no way to buy inside the embed. If nothing is
    # pinned yet, pin the most-recently-created active offer. Never override
    # an explicit pin, and never let a pin lookup failure block the
    # broadcast — going live matters more than the convenience pin.
    try:
        pin_res = (
            supabase.table("projects")
            .select("pinned_offer_id")
            .eq("id", project_uuid)
            .limit(1)
            .execute()
        )
        already_pinned = (
            pin_res.data[0].get("pinned_offer_id") if pin_res.data else None
        )
        active_offers = (
            supabase.table("offers")
            .select("id")
            .eq("project_id", project_uuid)
            .eq("is_active", True)
            .order("created_at", desc=True)
            .execute()
        )
        active_ids = [o["id"] for o in (active_offers.data or [])]
        # Re-pin when nothing is pinned OR the current pin points to an offer
        # that is no longer active (deactivated / deleted / sold-and-hidden) —
        # a stale pin renders no Buy button either. Respect a pin that still
        # points to a live offer: never override the merchant's explicit
        # choice. most-recently-created active offer wins.
        if active_ids and already_pinned not in active_ids:
            go_live_update["pinned_offer_id"] = active_ids[0]
            # No-timer pin: pinned_until stays null so the Buy button shows
            # with no countdown, and any stale deadline is cleared.
            go_live_update["pinned_until"] = None
            print(
                f"[ivs] auto-pinned offer {active_ids[0]} "
                f"on go-live for project={project_uuid}"
            )
    except Exception as exc:
        print(f"[ivs] auto-pin skipped (going live unpinned): {exc!r}")

    supabase.table("projects").update(go_live_update).eq("id", project_uuid).execute()
    print(f"[ivs] DB updated with fresh ARN for project={project_uuid}")

    # Notify "remind me when live" subscribers that the show has started.
    # Fire-and-forget on a daemon thread so a slow/large email batch never
    # delays the merchant's tap-to-broadcast. notify_project_live_now uses
    # the same atomic sent_at claim as the scheduled cron, so a subscriber
    # is emailed at most once even if both paths run. Best-effort: any
    # failure is logged inside the helper, never raised into go-live.
    try:
        import threading
        from services.agents.live_reminders import notify_project_live_now, notify_category_followers
        threading.Thread(
            target=notify_project_live_now,
            args=(project_uuid,),
            daemon=True,
        ).start()
        # Also ping followers of this shop's category (best-effort; no-ops if
        # the category_follows table isn't applied yet).
        threading.Thread(
            target=notify_category_followers,
            args=(project_uuid,),
            daemon=True,
        ).start()
    except Exception as exc:
        print(f"[ivs] live-now notify dispatch failed (ignored): {exc!r}")

    # Wait for AWS to fully propagate the new stage before minting
    # tokens. Originally 1.0s; halved to 0.5s after observed AWS
    # propagation in us-east-1 stays under 200ms in steady-state, so
    # 500ms is still ~2.5x headroom while shaving half a second off
    # every merchant's tap-to-broadcast time. If a future region adds
    # a stage propagation tail, push it to an env var rather than
    # ramping the global back up.
    await asyncio.sleep(0.5)
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

    # Phase 0 telemetry — best-effort INSERT into stream_sessions.
    # Failures are swallowed by the helper; never blocks the live path.
    from services.stream_telemetry import on_stream_start
    on_stream_start(
        supabase,
        project_id=project_uuid,
        owner_privy_id=project.get("privy_id") or user_id,
        provider="ivs_realtime",
        stage_arn=fresh_arn,
    )

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
    request: Request,
    user_id: str = Header(default="", convert_underscores=False),
):
    """Viewer gets a SUBSCRIBE participant token for a project's stage.

    body.context ("homepage_preview" etc.) is logged below for future
    metering visibility; it changes no behavior.

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

    # Phase 2 — stable per-viewer identity for cap / rate-limit / dedup.
    # Replaces the old `anon-<projectId>` shared bucket that conflated
    # every anonymous viewer of a project into one ID.
    from services.viewer_identity import derive_viewer_id_from_request
    viewer_id = derive_viewer_id_from_request(
        user_id=user_id or None,
        project_id=resolved_uuid,
        request=request,
    )

    if body.context:
        # Context tag is observe-only (see TokenRequest). Logged so the
        # operator can already see preview vs watch-view joins in Railway
        # logs before any metering column exists.
        print(f"[ivs] viewer-token context={body.context!r} viewer={viewer_id!r}")

    # Rate limit joins (now per-actual-viewer with stable IDs).
    join_err = check_join_rate(viewer_id)
    if join_err:
        raise HTTPException(status_code=429, detail=join_err)

    # Legacy global concurrent-viewer cap (in-memory, 50 default). Kept
    # as a belt-and-suspenders for the case where the per-tier check
    # below errors out — better to under-serve than to leak Mux/IVS
    # spend on a Supabase outage.
    viewer_err = add_viewer(resolved_uuid)
    if viewer_err:
        raise HTTPException(status_code=503, detail=viewer_err)

    res = (
        supabase.table("projects")
        .select("id, privy_id, ivs_stage_arn, is_live")
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

    # Phase 1 per-tier viewer cap, refined in Phase 2 to count DISTINCT
    # viewer_ids rather than total token mints. With stable viewer_ids
    # from derive_viewer_id_from_request above, the count now reflects
    # unique viewers (closer to true concurrent) instead of multi-tab
    # token churn.
    #
    # Resolver fails closed; surface as 503 with operator-actionable
    # detail. Telemetry-read failures fall open to the legacy in-memory
    # cap rather than refusing every viewer.
    from services.merchant_limits import (
        resolve_merchant_limits_by_privy_did,
        check_monthly_hard_block,
        MerchantLimitsUnresolved,
    )
    owner_privy_for_limits = project.get("privy_id")
    if owner_privy_for_limits:
        try:
            limits = resolve_merchant_limits_by_privy_did(
                owner_privy_for_limits, supabase=supabase,
            )
        except MerchantLimitsUnresolved as exc:
            print(f"[ivs] viewer-token cap-resolve refused: {exc!r}")
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "merchant_limits_unresolved",
                    "message": "This stream is temporarily unavailable.",
                },
            )
        # Phase 3a: monthly hard-block also gates viewer-token mints,
        # not just stream-start. A merchant could have a stream already
        # running when they cross the threshold — refuse new viewers
        # to that stream until they upgrade. Existing viewers are not
        # forcibly disconnected (Phase 3b will add that).
        hard_block_reason = check_monthly_hard_block(limits, supabase=supabase)
        if hard_block_reason:
            print(f"[ivs] viewer-token monthly hard block: {hard_block_reason}")
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "monthly_hard_block",
                    "message": "This stream is temporarily unavailable.",
                },
            )
        try:
            session_res = (
                supabase.table("stream_sessions")
                .select("id")
                .eq("project_id", resolved_uuid)
                .is_("end_at", "null")
                .order("start_at", desc=True)
                .limit(1)
                .execute()
            )
            if session_res.data:
                session_id = session_res.data[0]["id"]
                # Phase 2 anti-abuse: refuse if this specific viewer has
                # already minted MAX_TOKENS_PER_VIEWER tokens against
                # this stream session. Covers multi-tab (~3-4 expected),
                # refresh churn, and the simplest bot pattern. 5 is the
                # conservative ceiling — legitimate multi-tab almost
                # never exceeds this for one viewer on one stream.
                MAX_TOKENS_PER_VIEWER_PER_SESSION = 5
                viewer_mint_res = (
                    supabase.table("viewer_session_events")
                    .select("id", count="exact", head=True)
                    .eq("stream_session_id", session_id)
                    .eq("viewer_id", viewer_id)
                    .execute()
                )
                this_viewer_mints = viewer_mint_res.count or 0
                if this_viewer_mints >= MAX_TOKENS_PER_VIEWER_PER_SESSION:
                    # Loud log so operator sees abuse-shaped traffic.
                    # Note this is intentionally a 'warning' marker —
                    # Sentry / Railway log filters can grep on it later.
                    print(
                        f"[ivs] WARNING viewer_refresh_limit viewer={viewer_id!r} "
                        f"session={session_id} mints={this_viewer_mints} "
                        f"project={resolved_uuid}"
                    )
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "code": "viewer_refresh_limit",
                            "message": (
                                "Too many connection attempts to this stream from "
                                "your browser. Close any extra tabs and try again."
                            ),
                            "max_per_session": MAX_TOKENS_PER_VIEWER_PER_SESSION,
                        },
                    )

                # Cap check: DISTINCT viewer_ids. supabase-py's builder
                # doesn't expose DISTINCT directly, so we fetch the id
                # set and count in Python. Cap at 10x the merchant's
                # max_concurrent_viewers as a safety read-bound — if
                # the count exceeds that, we're already deep in abuse
                # territory and the rate-limiter / hard cap downstream
                # will refuse anyway.
                fetch_limit = max(1, limits.max_concurrent_viewers * 10)
                unique_res = (
                    supabase.table("viewer_session_events")
                    .select("viewer_id")
                    .eq("stream_session_id", session_id)
                    .limit(fetch_limit)
                    .execute()
                )
                unique_count = len({
                    r["viewer_id"] for r in (unique_res.data or [])
                })
                # If THIS viewer is already counted (a refresh case),
                # the new mint won't grow the set — allow it.
                already_counted = any(
                    r["viewer_id"] == viewer_id for r in (unique_res.data or [])
                )
                projected_count = unique_count if already_counted else unique_count + 1
                if projected_count > limits.max_concurrent_viewers:
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "code": "viewer_cap_reached",
                            "message": (
                                f"This stream is at its viewer cap "
                                f"({limits.max_concurrent_viewers}). "
                                f"Please try again in a few minutes."
                            ),
                            "tier": limits.plan_id,
                            "cap": limits.max_concurrent_viewers,
                            "current": unique_count,
                        },
                    )
        except HTTPException:
            raise
        except Exception as exc:
            # Telemetry-read failure: log and fall through to the legacy
            # cap. We've already passed add_viewer (the 50-global) above.
            print(f"[ivs] viewer cap telemetry read failed for project={resolved_uuid}: {exc!r}")

    # viewer_id is already computed above by derive_viewer_id_from_request.
    token_data = create_participant_token(
        stage_arn=project["ivs_stage_arn"],
        user_id=viewer_id,
        role="SUBSCRIBER",
    )
    if not token_data:
        raise HTTPException(status_code=502, detail="Failed to create viewer token")

    # Phase 0 telemetry — record the viewer-token mint AFTER all existing
    # caps have passed (so we only count tokens AWS actually issued).
    # Best-effort; never blocks.
    from services.stream_telemetry import on_viewer_token
    on_viewer_token(supabase, resolved_uuid, viewer_id)

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
    stage_id_for_replay = project.get("ivs_stage_id")
    if stage_arn:
        delete_stage(stage_arn)

    # Replay finalizer (replay-recording-infra, 2026-07-06): after the
    # stage ends, IVS finishes writing the host's recording to S3 over
    # the next minute or so. Poll for the playlist on a daemon thread,
    # then upsert live_replays and delete the PREVIOUS recording's
    # prefix (one recording per project — the cost cap). Fire-and-
    # forget: a failure just means "no replay this time".
    if stage_id_for_replay and is_recording_enabled():
        import threading

        # Replay length (replay-duration fix, 2026-08-01). find_latest_recording
        # returns playback_url/s3_prefix/recorded_at but NOT a duration, so
        # live_replays.duration_seconds stayed NULL forever even once recording
        # was armed — the storefront replay player had no length to show. The
        # show's own length is the right value and the most robust source (no
        # HLS playlist parsing): the still-open stream_sessions row was opened
        # at go-live and the show just ended, so now - start_at is the runtime.
        # Computed here (not in the thread) because on_stream_end below closes
        # the session a moment later. Best-effort: any failure leaves it NULL,
        # exactly like before — never blocks the finalize.
        replay_duration_seconds = None
        try:
            from datetime import datetime as _dt_dur, timezone as _tz_dur
            _sess = (
                get_client().table("stream_sessions")
                .select("start_at")
                .eq("project_id", project_uuid)
                .is_("end_at", "null")
                .order("start_at", desc=True)
                .limit(1)
                .execute()
            )
            if _sess.data and _sess.data[0].get("start_at"):
                _start = _dt_dur.fromisoformat(
                    str(_sess.data[0]["start_at"]).replace("Z", "+00:00")
                )
                replay_duration_seconds = max(
                    0, int((_dt_dur.now(_tz_dur.utc) - _start).total_seconds())
                )
        except Exception as exc:
            print(f"[ivs] replay duration calc failed for project={project_uuid}: {exc!r}")

        def _finalize_replay(pid: str, sid: str, duration_seconds):
            import time as _t
            found = None
            for _ in range(20):  # up to ~100s for S3 writes to settle
                found = find_latest_recording(sid)
                if found:
                    break
                _t.sleep(5)
            if not found:
                print(f"[ivs] replay finalize: no recording found for stage={sid}")
                return
            try:
                sb = get_client()
                prev = (
                    sb.table("live_replays")
                    .select("s3_prefix")
                    .eq("project_id", pid)
                    # Audit finding 3 (2026-07-07): without the source
                    # filter, limit(1) could return the merchant's UPLOAD
                    # row — and the cleanup below would delete their
                    # showcase video from S3 while its playback_url kept
                    # pointing at it. Only ever clean up old RECORDINGS.
                    .eq("source", "live_recording")
                    .limit(1)
                    .execute()
                )
                prev_prefix = prev.data[0].get("s3_prefix") if prev.data else None
                from datetime import datetime, timezone
                sb.table("live_replays").upsert(
                    {
                        "project_id": pid,
                        "source": "live_recording",
                        "playback_url": found["playback_url"],
                        "s3_prefix": found["s3_prefix"],
                        "recorded_at": found["recorded_at"],
                        "duration_seconds": duration_seconds,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                    on_conflict="project_id,source",
                ).execute()
                print(f"[ivs] replay saved for project={pid}: {found['playback_url']}")
                if prev_prefix and prev_prefix != found["s3_prefix"]:
                    delete_recording_prefix(prev_prefix)
            except Exception as exc:
                print(f"[ivs] replay finalize failed for project={pid}: {exc!r}")

        threading.Thread(
            target=_finalize_replay,
            args=(project_uuid, stage_id_for_replay, replay_duration_seconds),
            daemon=True,
        ).start()

    # Phase 0 telemetry — close the stream_sessions row before clearing
    # live state. Reads from in-memory _viewer_counts (via the helper)
    # for peak_concurrent, so call this BEFORE clear_stream() which
    # resets that counter.
    from services.stream_telemetry import on_stream_end
    on_stream_end(get_client(), project_uuid, "manual")

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
        # pinned_until must die with the pin - leaving it behind
        # produced a phantom "future timer with no offer" row that
        # confused every countdown surface (found live 2026-07-04).
        "pinned_until": None,
        "live_playback_id": None,
        "live_stream_id": None,
        "live_stream_key": None,
        "live_ingest_url": None,
    }).eq("id", project_uuid).execute()

    return {"status": "success", "is_live": False}


# ── Replay opt-in toggle (replay-recording-infra, 2026-07-06) ────────
# The merchant's "record my shows and loop the latest while I'm
# offline" switch. Owner-verified. Flipping it ON before any recording
# exists is the intended flow: the NEXT go-live records the host.
# The storefront wiring that actually plays the loop ships in
# replay-storefront-loop (queue item 17), not here.


class ReplayToggleRequest(BaseModel):
    project_id: str
    enabled: bool


@router.post("/replay-toggle")
async def api_replay_toggle(
    body: ReplayToggleRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    project = _verify_owner(body.project_id, user_id)
    project_uuid = project["id"]
    from datetime import datetime, timezone
    supabase = get_client()
    supabase.table("live_replays").upsert(
        {
            "project_id": project_uuid,
            "source": "live_recording",
            "enabled": body.enabled,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="project_id,source",
    ).execute()
    # Enabling the replay when the project has no active video yet makes
    # the replay the active one (least-surprise); disabling clears it.
    try:
        if body.enabled:
            active = (
                supabase.table("live_replays")
                .select("id")
                .eq("project_id", project_uuid)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )
            if not active.data:
                supabase.table("live_replays").update({"is_active": True}).eq(
                    "project_id", project_uuid
                ).eq("source", "live_recording").execute()
        else:
            supabase.table("live_replays").update({"is_active": False}).eq(
                "project_id", project_uuid
            ).eq("source", "live_recording").execute()
    except Exception as exc:
        print(f"[ivs] replay-toggle active sync failed (ignored): {exc!r}")
    return {
        "status": "success",
        "enabled": body.enabled,
        # Surfaces operator-side readiness so the dashboard can tell the
        # merchant "recording arms on your next show" vs "not available
        # yet" honestly.
        "recording_armed": is_recording_enabled(),
    }


@router.get("/replay-status")
async def api_replay_status(
    project_id: str,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """Owner view of their shop videos: replay opt-in, both sources,
    and which one is active (showcase-upload, queue 18)."""
    project = _verify_owner(project_id, user_id)
    project_uuid = project["id"]
    supabase = get_client()
    res = (
        supabase.table("live_replays")
        .select("source, enabled, playback_url, recorded_at, duration_seconds, is_active")
        .eq("project_id", project_uuid)
        .execute()
    )
    rows = res.data or []
    by_source = {r["source"]: r for r in rows}
    replay = by_source.get("live_recording", {})
    active = next((r["source"] for r in rows if r.get("is_active")), None)
    return {
        # Back-compat fields (the queue-17 card reads these):
        "enabled": bool(replay.get("enabled")),
        "playback_url": replay.get("playback_url"),
        "recorded_at": replay.get("recorded_at"),
        "duration_seconds": replay.get("duration_seconds"),
        "recording_armed": is_recording_enabled(),
        # Queue-18 additions:
        "upload_enabled": is_showcase_upload_enabled(),
        "active_source": active,
        "videos": [
            {
                "source": r["source"],
                "playback_url": r.get("playback_url"),
                "recorded_at": r.get("recorded_at"),
                "is_active": bool(r.get("is_active")),
            }
            for r in rows
            if r.get("playback_url")
        ],
    }


# ── Showcase upload (showcase-upload, queue 18) ─────────────────────
# "Record or upload a showcase" — video on the shop WITHOUT going
# live. On phones the dashboard's file input opens the camera, so
# upload IS record. Caps: 5 min guidance, 500MB hard (checked at
# confirm; oversize objects are deleted). One upload per project —
# a new one replaces the old object, same cost stance as recordings.


class ShowcaseUploadUrlRequest(BaseModel):
    project_id: str
    content_type: str


@router.post("/showcase-upload-url")
async def api_showcase_upload_url(
    body: ShowcaseUploadUrlRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    project = _verify_owner(body.project_id, user_id)
    project_uuid = project["id"]
    if not is_showcase_upload_enabled():
        raise HTTPException(status_code=503, detail="Showcase uploads are not available yet")
    ext = SHOWCASE_CONTENT_TYPES.get(body.content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Use an mp4, mov, or webm video")
    import time as _t
    key = f"uploads/{project_uuid}/showcase-{int(_t.time())}.{ext}"
    url = create_showcase_upload_url(key, body.content_type)
    if not url:
        raise HTTPException(status_code=502, detail="Could not prepare the upload")
    return {"upload_url": url, "key": key, "max_bytes": SHOWCASE_MAX_BYTES}


class ShowcaseUploadedRequest(BaseModel):
    project_id: str
    key: str


@router.post("/showcase-uploaded")
async def api_showcase_uploaded(
    body: ShowcaseUploadedRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    project = _verify_owner(body.project_id, user_id)
    project_uuid = project["id"]
    # The key must be one we would have presigned for THIS project.
    if not body.key.startswith(f"uploads/{project_uuid}/"):
        raise HTTPException(status_code=400, detail="Key does not belong to this project")
    size = head_object_size(body.key)
    if size is None:
        raise HTTPException(status_code=400, detail="Upload not found — did the transfer finish?")
    if size > SHOWCASE_MAX_BYTES:
        delete_object(body.key)
        raise HTTPException(status_code=400, detail="Video is over 500MB — trim it and try again")

    from datetime import datetime, timezone
    supabase = get_client()
    prev = (
        supabase.table("live_replays")
        .select("s3_prefix")
        .eq("project_id", project_uuid)
        .eq("source", "upload")
        .limit(1)
        .execute()
    )
    prev_key = prev.data[0].get("s3_prefix") if prev.data else None
    now_iso = datetime.now(timezone.utc).isoformat()
    supabase.table("live_replays").upsert(
        {
            "project_id": project_uuid,
            "source": "upload",
            "enabled": True,
            "playback_url": public_url_for_key(body.key),
            "s3_prefix": body.key,
            "recorded_at": now_iso,
            "updated_at": now_iso,
        },
        on_conflict="project_id,source",
    ).execute()
    # First video on the shop becomes active automatically; otherwise
    # the merchant's existing pick stands.
    try:
        active = (
            supabase.table("live_replays")
            .select("id")
            .eq("project_id", project_uuid)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if not active.data:
            supabase.table("live_replays").update({"is_active": True}).eq(
                "project_id", project_uuid
            ).eq("source", "upload").execute()
    except Exception as exc:
        print(f"[ivs] showcase active sync failed (ignored): {exc!r}")
    if prev_key and prev_key != body.key:
        delete_object(prev_key)
    return {"status": "success", "playback_url": public_url_for_key(body.key)}


class ReplayBeatRequest(BaseModel):
    project_id: str
    source: str = "replay"


@router.post("/replay-beat")
async def api_replay_beat(body: ReplayBeatRequest, request: Request):
    """Recorded-video watch-time beat (replay-viewer-hour-metering,
    queue 20). The storefront/embed player POSTs one beat per ~30s of
    playback; each beat credits a SERVER-FIXED 30 seconds to the
    merchant's combined monthly viewer-hours plus the replay split.

    Abuse hardening (security review 2026-07-07): this endpoint is
    public (viewers aren't authenticated), and inflated viewer_seconds
    can push a merchant past the monthly hard-block — i.e. a griefer
    could silence a shop. Three gates, all silent (always 200, so a
    metering refusal never breaks playback):
      1. Per-IP rate limit: 3 beats/min — a real viewer emits at most
         2/min (storefront + embed), so spam from one source is capped
         at 1.5 viewer-minutes per wall-clock minute.
      2. The project must actually have an active recorded video —
         beats for shops with nothing to play are dropped.
      3. The shop must be OFFLINE — while live, the replay never plays
         (live always wins), so live-time beats are dropped.
    Clients say 'still watching', never how long; the 30s credit stays
    server-fixed."""
    src = "showcase" if body.source == "showcase" else "replay"
    try:
        # Identifier hardening (audit finding 1, 2026-07-07): the shared
        # client_ip_from_request takes the FIRST x-forwarded-for entry,
        # which the CLIENT controls (proxies append, so the attacker's
        # prepended value wins) — spoofed headers made the per-IP limit
        # worthless. Trust order here: rightmost XFF entry (appended by
        # our own edge), then the socket peer. Never the client's side
        # of the header.
        try:
            xff = (request.headers.get("x-forwarded-for") or "").split(",")
            beat_ip = (
                (xff[-1].strip() if xff and xff[-1].strip() else "")
                or (request.client.host if request.client else "")
                or "unknown"
            )
        except Exception:
            beat_ip = "unknown"
        try:
            enforce_rate_limit(beat_ip, "replay-beat", 3)
            # Per-project ceiling (finding 1b): even with unique IPs (bot
            # fleet), one project can't accrue more than 120 beats/min —
            # a generous Phase-0/1 audience bound (~60 concurrent viewers
            # across surfaces) that caps griefing at a knowable worst
            # case instead of "unbounded". Single-uvicorn-worker keeps
            # this in-memory limiter authoritative (realtime decision
            # 2026-07-05).
            enforce_rate_limit(f"proj:{body.project_id}", "replay-beat-project", 120)
        except HTTPException:
            return {"status": "ok"}  # silently dropped — spam or over-eager client
        supabase = get_client()
        proj = (
            supabase.table("projects")
            .select("id, is_live")
            .eq("id", body.project_id)
            .limit(1)
            .execute()
        )
        if not proj.data or proj.data[0].get("is_live"):
            return {"status": "ok"}  # unknown project or live show — nothing to meter
        active = (
            supabase.table("live_replays")
            .select("id")
            .eq("project_id", proj.data[0]["id"])
            .eq("is_active", True)
            .not_.is_("playback_url", "null")
            .limit(1)
            .execute()
        )
        if not active.data:
            return {"status": "ok"}  # no active video — nothing could be playing
        from services.stream_telemetry import record_replay_beat
        record_replay_beat(supabase, body.project_id, source=src, seconds=30)
    except Exception as exc:
        print(f"[ivs] replay-beat failed (ignored): {exc!r}")
    return {"status": "ok"}


class ShowcaseActivateRequest(BaseModel):
    project_id: str
    source: str


@router.post("/showcase-activate")
async def api_showcase_activate(
    body: ShowcaseActivateRequest,
    user_id: str = Header(default="demo-user", convert_underscores=False),
):
    """The merchant's 'this one plays on my shop' picker."""
    if body.source not in ("live_recording", "upload"):
        raise HTTPException(status_code=400, detail="Unknown video source")
    project = _verify_owner(body.project_id, user_id)
    project_uuid = project["id"]
    supabase = get_client()
    supabase.table("live_replays").update({"is_active": False}).eq(
        "project_id", project_uuid
    ).execute()
    supabase.table("live_replays").update({"is_active": True}).eq(
        "project_id", project_uuid
    ).eq("source", body.source).execute()
    return {"status": "success", "active_source": body.source}
