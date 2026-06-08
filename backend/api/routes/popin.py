"""
Pop-In Seller video uploads — Path 2 hardening sprint PR 1.

Serves the recorded-video upload path that frontend/lib/popinVideoUpload.ts
performs browser-direct against Supabase Storage today. This endpoint
mirrors transcribe.py's UploadFile + size-guard shape, with project-
ownership gating via _verify_project_owner (reused from offers.py).

The browser-direct site remains live until the frontend-swap PR in the
Path 2 sequence (PR 5) — both paths coexist. This module is additive
only; no existing endpoint changes.

Scoped to a thin one-route module so the popin surface stays isolated
from the dense /api/projects router. Registered in backend/main.py
with prefix='/api/popin'.
"""

from __future__ import annotations

import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from auth.privy import get_current_user
from db.supabase import get_client
from api.routes.offers import _verify_project_owner

router = APIRouter()


# 50 MB cap — NEW guard. popinVideoUpload.ts has no client-side limit
# today; this endpoint closes that gap server-side so a forged or
# accidentally-huge video can't exhaust Railway egress / Supabase
# bandwidth. Matches what the path-2 plan committed to.
_MAX_VIDEO_BYTES = 50 * 1024 * 1024

# Mirror the extension whitelist popinVideoUpload.ts validates client-side
# (frontend/lib/popinVideoUpload.ts:88). Adds 'quicktime' for the case where
# the browser hands us a content-type of video/quicktime but the filename
# ext is 'mov' — both decode to the same payload.
_ALLOWED_VIDEO_EXT = {"mp4", "webm", "mov", "quicktime"}
_VIDEO_EXT_RE = re.compile(r"^[a-z0-9]{1,9}$")


def _safe_video_extension(filename: Optional[str], default: str = "mp4") -> str:
    if not filename or "." not in filename:
        return default
    ext = filename.rsplit(".", 1)[-1].lower().strip()
    if not _VIDEO_EXT_RE.match(ext):
        return default
    return ext if ext in _ALLOWED_VIDEO_EXT else default


@router.post("/upload-video")
async def upload_popin_video(
    project_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Server-mediated Pop-In recorded-video upload.

    Form fields:
      project_id: the project the video belongs to (ownership-gated)
      file: multipart video (video/*, allowed ext: mp4/webm/mov, ≤ 50 MB)

    Mirrors the storage layout popinVideoUpload.ts writes today
    (popin-videos/<project_id>/<timestamp>.<ext>) so the existing
    popin_config.video_url field consumes the returned public_url
    unchanged.

    Returns: {"public_url": str, "path": str}
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    content_type = (file.content_type or "").lower()
    if not content_type.startswith("video/"):
        raise HTTPException(
            status_code=400,
            detail="File must be a video (MP4, WebM, MOV).",
        )

    ext = _safe_video_extension(file.filename)
    if ext not in _ALLOWED_VIDEO_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"File extension must be one of: {', '.join(sorted(_ALLOWED_VIDEO_EXT))}.",
        )

    contents = await file.read()
    if len(contents) > _MAX_VIDEO_BYTES:
        size_mb = len(contents) / 1024 / 1024
        raise HTTPException(
            status_code=413,
            detail=f"File is too large ({size_mb:.1f}MB). Max 50MB.",
        )

    supabase = get_client()

    # Owner gate — 404 on missing project, 403 on wrong owner. Verbatim
    # reuse of the helper offers.py already exposes.
    _verify_project_owner(supabase, project_id, privy_id)

    path = f"popin-videos/{project_id}/{int(time.time() * 1000)}.{ext}"

    try:
        supabase.storage.from_("offers").upload(
            path=path,
            file=contents,
            file_options={
                "content-type": content_type,
                "cache-control": "3600",
                "upsert": "false",
            },
        )
    except Exception as exc:
        print(f"[upload] popin video upload failed for project={project_id}: {type(exc).__name__}: {exc}")
        raise HTTPException(status_code=500, detail="Upload failed. Try again.")

    public_url = supabase.storage.from_("offers").get_public_url(path)

    return {"public_url": public_url, "path": path}
