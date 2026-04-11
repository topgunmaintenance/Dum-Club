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

_client = None


def is_ivs_enabled() -> bool:
    return _ENABLED and bool(_AWS_ACCESS_KEY and _AWS_SECRET_KEY)


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


def create_stage(name: str) -> Optional[dict]:
    """Create an IVS Real-Time stage. Returns stage ARN and ID."""
    client = _get_client()
    if not client:
        return None

    try:
        response = client.create_stage(name=name)
        stage = response.get("stage", {})
        print(f"[ivs] Stage created: {stage.get('arn')}")
        return {
            "stage_arn": stage.get("arn", ""),
            "stage_id": stage.get("arn", "").split("/")[-1] if stage.get("arn") else "",
            "name": stage.get("name", ""),
        }
    except Exception as exc:
        print(f"[ivs] create_stage failed: {exc!r}")
        return None


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
