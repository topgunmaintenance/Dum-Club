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


async def create_live_stream() -> Optional[dict]:
    """Create a Mux live stream. Returns dict with stream_id, stream_key, playback_id, ingest_url."""
    if not is_mux_configured():
        return None

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

    if res.status_code not in (200, 201):
        print(f"[mux] create_live_stream failed: {res.status_code} {res.text[:200]}")
        return None

    data = res.json().get("data", {})
    stream_key = data.get("stream_key", "")
    playback_ids = data.get("playback_ids", [])
    playback_id = playback_ids[0]["id"] if playback_ids else ""

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
