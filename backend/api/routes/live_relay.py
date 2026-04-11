"""
Live Relay — WebSocket endpoint that pipes browser MediaRecorder chunks
through ffmpeg to Mux RTMP ingest.

Architecture:
  Browser (getUserMedia → MediaRecorder webm)
    → WebSocket binary messages
      → ffmpeg -f webm -i pipe:0 -c:v copy -c:a aac -f flv rtmps://...
        → Mux ingest → HLS CDN → MuxPlayer (viewers)
"""
import asyncio
import shutil
import json
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from db.supabase import get_client

router = APIRouter()

FFMPEG_PATH = shutil.which("ffmpeg") or "ffmpeg"


def _get_project_stream_key(project_id: str) -> Optional[str]:
    """Look up the Mux stream key for a project."""
    supabase = get_client()
    res = (
        supabase.table("projects")
        .select("live_stream_key, live_ingest_url")
        .eq("id", project_id)
        .eq("is_deleted", False)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0].get("live_stream_key")


def _get_ingest_url(project_id: str) -> Optional[str]:
    supabase = get_client()
    res = (
        supabase.table("projects")
        .select("live_ingest_url")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0].get("live_ingest_url")


@router.websocket("/stream/{project_id}")
async def live_relay(websocket: WebSocket, project_id: str):
    """
    Accept binary WebSocket messages (webm chunks from MediaRecorder)
    and pipe them to ffmpeg → Mux RTMP.
    """
    await websocket.accept()
    print(f"[live-relay] WebSocket connected for project {project_id}")

    # Check ffmpeg availability
    if not shutil.which("ffmpeg"):
        print("[live-relay] ERROR: ffmpeg not found in PATH")
        await websocket.send_text(json.dumps({"error": "ffmpeg not available on server"}))
        await websocket.close(code=1011)
        return

    # Get stream key from project
    stream_key = _get_project_stream_key(project_id)
    if not stream_key:
        print(f"[live-relay] ERROR: no stream key for project {project_id}")
        await websocket.send_text(json.dumps({"error": "No stream key found — create a Mux stream first"}))
        await websocket.close(code=1008)
        return

    ingest_url = f"rtmps://global-live.mux.com:443/app/{stream_key}"
    print(f"[live-relay] Starting ffmpeg relay to {ingest_url[:50]}...")

    # Spawn ffmpeg
    # -f webm -i pipe:0     → read webm from stdin
    # -c:v copy              → pass through video (VP8/VP9 from browser)
    # -c:a aac -b:a 128k    → transcode audio to AAC (RTMP requires AAC)
    # -f flv                 → output FLV container for RTMP
    ffmpeg_proc: Optional[asyncio.subprocess.Process] = None
    try:
        ffmpeg_proc = await asyncio.create_subprocess_exec(
            FFMPEG_PATH,
            "-hide_banner",
            "-loglevel", "warning",
            "-f", "webm",
            "-i", "pipe:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "128k",
            "-f", "flv",
            ingest_url,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        print(f"[live-relay] ffmpeg started, PID={ffmpeg_proc.pid}")

        # Send status to client
        await websocket.send_text(json.dumps({"status": "streaming", "pid": ffmpeg_proc.pid}))

        # Read stderr in background for logging
        async def log_ffmpeg_stderr():
            if ffmpeg_proc and ffmpeg_proc.stderr:
                async for line in ffmpeg_proc.stderr:
                    text = line.decode(errors="replace").strip()
                    if text:
                        print(f"[live-relay][ffmpeg] {text}")

        stderr_task = asyncio.create_task(log_ffmpeg_stderr())

        # Main loop: receive binary chunks from browser, pipe to ffmpeg
        chunk_count = 0
        while True:
            data = await websocket.receive_bytes()
            chunk_count += 1
            if ffmpeg_proc.stdin:
                ffmpeg_proc.stdin.write(data)
                await ffmpeg_proc.stdin.drain()

            if chunk_count % 50 == 0:
                print(f"[live-relay] {chunk_count} chunks relayed ({len(data)} bytes last)")

    except WebSocketDisconnect:
        print(f"[live-relay] WebSocket disconnected (project {project_id})")
    except Exception as exc:
        print(f"[live-relay] Error: {exc!r}")
    finally:
        # Clean up ffmpeg
        if ffmpeg_proc:
            try:
                if ffmpeg_proc.stdin:
                    ffmpeg_proc.stdin.close()
                ffmpeg_proc.terminate()
                try:
                    await asyncio.wait_for(ffmpeg_proc.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    ffmpeg_proc.kill()
                print(f"[live-relay] ffmpeg stopped for project {project_id}")
            except Exception as cleanup_err:
                print(f"[live-relay] ffmpeg cleanup error: {cleanup_err!r}")

        print(f"[live-relay] Relay ended for project {project_id}")
