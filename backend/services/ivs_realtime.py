"""
Amazon IVS Real-Time — Stage and Participant Token management.

Uses IVS Real-Time Stages API for sub-300ms WebRTC-based live streaming.
Gracefully disabled when AWS credentials or feature flag not set.
"""
import os
from typing import Optional

_AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID", "")
_AWS_SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
_AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
_ENABLED = os.getenv("ENABLE_IVS_REALTIME_BACKEND", "false").lower() == "true"

# ── Replay recording (replay-recording-infra, 2026-07-06) ──────────
# Recording is opt-in at TWO levels: this env switch (operator) AND the
# merchant's "loop my last show" toggle (live_replays.enabled). All
# three env vars must be set for recording to arm:
#   ENABLE_IVS_RECORDING=true
#   IVS_RECORDING_STORAGE_ARN  — ivs-realtime StorageConfiguration ARN
#                                (created once in the AWS console,
#                                points at the recordings bucket)
#   IVS_RECORDING_BUCKET       — that bucket's name (for lookup/cleanup)
# Optional: REPLAY_PUBLIC_BASE_URL — CDN/base URL that serves the
# bucket; defaults to the S3 https endpoint.
_RECORDING_ENABLED = os.getenv("ENABLE_IVS_RECORDING", "false").lower() == "true"
_RECORDING_STORAGE_ARN = os.getenv("IVS_RECORDING_STORAGE_ARN", "")
_RECORDING_BUCKET = os.getenv("IVS_RECORDING_BUCKET", "")
_REPLAY_PUBLIC_BASE = (
    os.getenv("REPLAY_PUBLIC_BASE_URL", "").rstrip("/")
    or (f"https://{_RECORDING_BUCKET}.s3.{_AWS_REGION}.amazonaws.com" if _RECORDING_BUCKET else "")
)

_client = None
_s3_client = None


def is_ivs_enabled() -> bool:
    return _ENABLED and bool(_AWS_ACCESS_KEY and _AWS_SECRET_KEY)


def is_recording_enabled() -> bool:
    """True only when the operator has armed recording end-to-end:
    flag + storage configuration + bucket. Any missing piece keeps
    every stage recording-free, preserving the original cost stance."""
    return (
        is_ivs_enabled()
        and _RECORDING_ENABLED
        and bool(_RECORDING_STORAGE_ARN)
        and bool(_RECORDING_BUCKET)
    )


def _get_s3():
    global _s3_client
    if _s3_client is not None:
        return _s3_client
    try:
        import boto3
        _s3_client = boto3.client(
            "s3",
            region_name=_AWS_REGION,
            aws_access_key_id=_AWS_ACCESS_KEY,
            aws_secret_access_key=_AWS_SECRET_KEY,
        )
        return _s3_client
    except Exception as exc:
        print(f"[ivs] Failed to create s3 client: {exc!r}")
        return None


def _get_client():
    global _client
    if _client is not None:
        return _client
    try:
        import boto3
        _client = boto3.client(
            "ivs-realtime",
            region_name=_AWS_REGION,
            aws_access_key_id=_AWS_ACCESS_KEY,
            aws_secret_access_key=_AWS_SECRET_KEY,
        )
        return _client
    except ImportError:
        print("[ivs] boto3 not installed")
        return None
    except Exception as exc:
        print(f"[ivs] Failed to create client: {exc!r}")
        return None


def create_stage(name: str, record: bool = False) -> Optional[dict]:
    """Create an IVS Real-Time stage. Returns stage ARN and ID.

    Cost contract (updated for replay-recording-infra, 2026-07-06 —
    supersedes the old blanket assert):

    Recording only publishers (the host), never viewers, and only when
    BOTH the operator armed it (see is_recording_enabled: env flag +
    storage configuration + bucket) AND this call passes record=True
    (which the route derives from the merchant's own "loop my last
    show" opt-in). The retention tail that the old guardrail demanded
    exists now: exactly ONE recording is kept per project — the
    previous S3 prefix is deleted when a new recording lands (see
    delete_recording_prefix / the end-stage finalizer in routes/ivs.py)
    — and the bucket carries a lifecycle rule as a backstop. Only the
    host's AUDIO_VIDEO is written, so cost scales with hosts (1 per
    stream), not with the viewer count.

    The guardrail survives in a stricter form: recording kwargs are
    only ever attached behind is_recording_enabled(), so a stage can
    never record unless the storage plumbing is verifiably configured.
    """
    client = _get_client()
    if not client:
        return None

    stage_kwargs = {"name": name}
    recording_armed = record and is_recording_enabled()
    if recording_armed:
        stage_kwargs["autoParticipantRecordingConfiguration"] = {
            "storageConfigurationArn": _RECORDING_STORAGE_ARN,
            "mediaTypes": ["AUDIO_VIDEO"],
        }
    elif record:
        print(
            "[ivs] recording requested but not armed "
            "(ENABLE_IVS_RECORDING / storage ARN / bucket missing) — "
            "creating stage WITHOUT recording"
        )

    try:
        response = client.create_stage(**stage_kwargs)
        stage = response.get("stage", {})
        print(
            f"[ivs] Stage created: {stage.get('arn')} "
            f"({'recording host to S3' if recording_armed else 'no recording config'})"
        )
        return {
            "stage_arn": stage.get("arn", ""),
            "stage_id": stage.get("arn", "").split("/")[-1] if stage.get("arn") else "",
            "name": stage.get("name", ""),
            "recording": recording_armed,
        }
    except Exception as exc:
        print(f"[ivs] create_stage failed: {exc!r}")
        return None


def find_latest_recording(stage_id: str) -> Optional[dict]:
    """Locate the playlist of the recording IVS wrote for a stage.

    Auto-participant recording writes HLS under a per-stage/participant
    prefix in the storage bucket. Layouts have shifted across IVS
    releases, so instead of hardcoding one, scan the stage's prefix for
    playlist files and pick the newest multivariant/master. Returns
    {playback_url, s3_prefix, recorded_at} or None. Best-effort — every
    failure returns None and the caller treats it as "no replay yet".
    """
    if not is_recording_enabled():
        return None
    s3 = _get_s3()
    if not s3 or not stage_id:
        return None
    try:
        resp = s3.list_objects_v2(Bucket=_RECORDING_BUCKET, Prefix=f"{stage_id}/", MaxKeys=1000)
        contents = resp.get("Contents", [])
        playlists = [
            o for o in contents
            if o["Key"].endswith(("multivariant.m3u8", "master.m3u8", "playlist.m3u8"))
        ]
        if not playlists:
            return None
        # Prefer the top-level variant manifest; newest last-modified wins.
        playlists.sort(key=lambda o: (o["Key"].count("/"), ))
        top_depth = playlists[0]["Key"].count("/")
        candidates = [o for o in playlists if o["Key"].count("/") == top_depth]
        best = max(candidates, key=lambda o: o["LastModified"])
        key = best["Key"]
        prefix = key.rsplit("/", 1)[0]
        return {
            "playback_url": f"{_REPLAY_PUBLIC_BASE}/{key}",
            "s3_prefix": prefix,
            "recorded_at": best["LastModified"].isoformat(),
        }
    except Exception as exc:
        print(f"[ivs] find_latest_recording failed for stage={stage_id}: {exc!r}")
        return None


def delete_recording_prefix(s3_prefix: str) -> bool:
    """Delete every object under a previous recording's prefix.

    The one-recording-per-project cost cap: called by the end-stage
    finalizer when a NEW recording replaces an old one. Best-effort —
    the bucket lifecycle rule is the backstop for anything missed.
    """
    if not is_recording_enabled() or not s3_prefix:
        return False
    s3 = _get_s3()
    if not s3:
        return False
    try:
        resp = s3.list_objects_v2(Bucket=_RECORDING_BUCKET, Prefix=s3_prefix, MaxKeys=1000)
        keys = [{"Key": o["Key"]} for o in resp.get("Contents", [])]
        if keys:
            s3.delete_objects(Bucket=_RECORDING_BUCKET, Delete={"Objects": keys})
            print(f"[ivs] deleted {len(keys)} object(s) under old replay prefix {s3_prefix}")
        return True
    except Exception as exc:
        print(f"[ivs] delete_recording_prefix failed for {s3_prefix}: {exc!r}")
        return False


def create_participant_token(
    stage_arn: str,
    user_id: str,
    role: str = "SUBSCRIBER",
    duration_minutes: int = 60,
) -> Optional[dict]:
    """
    Create a participant token for a stage.
    role: "PUBLISHER" (host) or "SUBSCRIBER" (viewer)
    """
    client = _get_client()
    if not client:
        return None

    capabilities = ["SUBSCRIBE"]
    if role == "PUBLISHER":
        capabilities = ["PUBLISH", "SUBSCRIBE"]

    print(f"[ivs] create_participant_token: stageArn={stage_arn}, user={user_id}, role={role}, capabilities={capabilities}, duration={duration_minutes}min")

    try:
        response = client.create_participant_token(
            stageArn=stage_arn,
            userId=user_id,
            capabilities=capabilities,
            duration=duration_minutes,  # API expects minutes
        )
        token_data = response.get("participantToken", {})
        token_val = token_data.get("token", "")
        print(f"[ivs] Token created: user={user_id}, role={role}, has_token={bool(token_val)}, token_len={len(token_val)}, participant_id={token_data.get('participantId')}, expiration={token_data.get('expirationTime')}")
        return {
            "token": token_val,
            "participant_id": token_data.get("participantId", ""),
            "expiration": str(token_data.get("expirationTime", "")),
        }
    except Exception as exc:
        print(f"[ivs] create_participant_token FAILED: {exc!r}")
        return None


def delete_stage(stage_arn: str) -> bool:
    """Delete an IVS stage."""
    client = _get_client()
    if not client:
        return False

    try:
        client.delete_stage(arn=stage_arn)
        print(f"[ivs] Stage deleted: {stage_arn}")
        return True
    except Exception as exc:
        print(f"[ivs] delete_stage failed: {exc!r}")
        return False


def disconnect_participant(stage_arn: str, participant_id: str) -> bool:
    """Disconnect a participant from a stage."""
    client = _get_client()
    if not client:
        return False

    try:
        client.disconnect_participant(
            stageArn=stage_arn,
            participantId=participant_id,
        )
        print(f"[ivs] Participant disconnected: {participant_id}")
        return True
    except Exception as exc:
        print(f"[ivs] disconnect_participant failed: {exc!r}")
        return False
