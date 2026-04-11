"""
Mux Live Streaming — create / manage live streams.

Gracefully disabled when MUX_TOKEN_ID / MUX_TOKEN_SECRET are not set.
Uses Mux REST API directly (no SDK dependency required).
"""
import os
import httpx
from typing import Optional

MUX_TOKEN_ID = os.getenv("MUX_TOKEN_ID", "")
MUX_TOKEN_SECRET = os.getenv("MUX_TOKEN_SECRET", "")
MUX_API_BASE = "https://api.mux.com"


def is_mux_configured() -> bool:
    return bool(MUX_TOKEN_ID and MUX_TOKEN_SECRET)


def _auth() -> tuple[str, str]:
    return (MUX_TOKEN_ID, MUX_TOKEN_SECRET)


async def create_live_stream() -> dict:
    """Create a Mux live stream. Returns dict with stream data or error details."""
    if not is_mux_configured():
        return {"error": "mux_not_configured", "detail": "MUX_TOKEN_ID or MUX_TOKEN_SECRET not set"}

    print(f"[mux] Creating live stream. Token ID present: {bool(MUX_TOKEN_ID)}, Secret present: {bool(MUX_TOKEN_SECRET)}")

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{MUX_API_BASE}/video/v1/live-streams",
                auth=_auth(),
                json={
                    "playback_policy": ["public"],
                    "new_asset_settings": {"playback_policy": ["public"]},
                    "reduced_latency": True,
                },
                timeout=15.0,
            )
    except Exception as exc:
        msg = f"Mux API request failed: {exc!r}"
        print(f"[mux] {msg}")
        return {"error": "mux_request_failed", "detail": msg}

    print(f"[mux] Response: status={res.status_code}")

    if res.status_code == 401:
        print(f"[mux] 401 Unauthorized — bad credentials or token")
        return {"error": "mux_auth_failed", "detail": "Mux returned 401 — check MUX_TOKEN_ID and MUX_TOKEN_SECRET"}

    if res.status_code == 403:
        body = res.text[:500]
        print(f"[mux] 403 Forbidden — account may not have live stream entitlement: {body}")
        return {"error": "mux_forbidden", "detail": f"Mux returned 403 — account may not have live streaming enabled. Response: {body}"}

    if res.status_code not in (200, 201):
        body = res.text[:500]
        print(f"[mux] Unexpected status {res.status_code}: {body}")
        return {"error": "mux_api_error", "detail": f"Mux returned {res.status_code}: {body}"}

    data = res.json().get("data", {})
    stream_key = data.get("stream_key", "")
    playback_ids = data.get("playback_ids", [])
    playback_id = playback_ids[0]["id"] if playback_ids else ""

    print(f"[mux] Stream created: id={data.get('id')}, has_key={bool(stream_key)}, has_playback={bool(playback_id)}")

    return {
        "stream_id": data.get("id", ""),
        "stream_key": stream_key,
        "playback_id": playback_id,
        "ingest_url": f"rtmps://global-live.mux.com:443/app/{stream_key}",
    }


async def get_stream_status(stream_id: str) -> Optional[str]:
    """Get Mux live stream status: idle, active, disabled."""
    if not is_mux_configured() or not stream_id:
        return None

    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"{MUX_API_BASE}/video/v1/live-streams/{stream_id}",
            auth=_auth(),
            timeout=10.0,
        )

    if res.status_code != 200:
        return None

    return res.json().get("data", {}).get("status")


async def disable_live_stream(stream_id: str) -> bool:
    """Disable (end) a Mux live stream."""
    if not is_mux_configured() or not stream_id:
        return False

    async with httpx.AsyncClient() as client:
        res = await client.put(
            f"{MUX_API_BASE}/video/v1/live-streams/{stream_id}/disable",
            auth=_auth(),
            timeout=10.0,
        )

    return res.status_code == 200
