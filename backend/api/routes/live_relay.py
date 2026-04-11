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
    print(f"[live-relay] Starting ffmpeg relay to Mux for project {project_id}")
    print(f"[live-relay] Ingest URL: {ingest_url[:60]}...")
    print(f"[live-relay] ffmpeg path: {FFMPEG_PATH}")

    # Spawn ffmpeg
    # Browser sends webm (VP8+Opus on Chrome/Firefox) or mp4 (H.264+AAC on Safari).
    # RTMP/FLV requires H.264 + AAC. We transcode video to H.264 always (cheap if
    # Safari already sends H.264 — ffmpeg will detect and copy if possible).
    # Let ffmpeg auto-detect input format via probe (no -f flag for input).
    ffmpeg_proc: Optional[asyncio.subprocess.Process] = None
    try:
        ffmpeg_cmd = [
            FFMPEG_PATH,
            "-hide_banner",
            "-loglevel", "info",
            "-fflags", "+genpts+nobuffer",
            "-probesize", "1000000",
            "-analyzeduration", "1000000",
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-g", "60",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-ar", "44100",
            "-f", "flv",
            ingest_url,
        ]
        print(f"[live-relay] ffmpeg command: {' '.join(ffmpeg_cmd)}")

        ffmpeg_proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
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
            # Log exit code when ffmpeg exits
            if ffmpeg_proc:
                code = await ffmpeg_proc.wait()
                print(f"[live-relay][ffmpeg] Process exited with code {code}")

        stderr_task = asyncio.create_task(log_ffmpeg_stderr())

        # Main loop: receive binary chunks from browser, pipe to ffmpeg
        chunk_count = 0
        total_bytes = 0
        while True:
            data = await websocket.receive_bytes()
            chunk_count += 1
            total_bytes += len(data)

            # Check if ffmpeg is still running
            if ffmpeg_proc.returncode is not None:
                print(f"[live-relay] ERROR: ffmpeg exited with code {ffmpeg_proc.returncode} after {chunk_count} chunks")
                await websocket.send_text(json.dumps({"error": f"ffmpeg exited unexpectedly (code {ffmpeg_proc.returncode})"}))
                break

            if ffmpeg_proc.stdin:
                ffmpeg_proc.stdin.write(data)
                await ffmpeg_proc.stdin.drain()

            # Log first 5 chunks individually, then every 100
            if chunk_count <= 5 or chunk_count % 100 == 0:
                print(f"[live-relay] Chunk #{chunk_count}: {len(data)} bytes (total: {total_bytes} bytes)")

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
