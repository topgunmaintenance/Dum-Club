"""
Content reports — trust & safety.

Public endpoint so any viewer (signed-in or guest) can report a live
stream / storefront. Rows land in content_reports (migration 071) for
operator review; writes go through the service-role client so RLS keeps
the table out of direct anon/authenticated reach.

This is the buildable slice of moderation. Real-time chat ban/mute is
deliberately not here: the live chat transport carries client-supplied,
unauthenticated sender ids, so a per-id ban would be trivially evaded —
that needs authenticated chat identities first.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.supabase import get_client
from auth.privy import get_optional_current_user

router = APIRouter()

_ALLOWED_REASONS = {"spam", "scam", "inappropriate", "counterfeit", "other"}


class ReportSubmit(BaseModel):
    project_id: Optional[str] = None
    reason: str
    details: Optional[str] = None


@router.post("/")
async def submit_report(
    body: ReportSubmit,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    """Record a content report. Reason is validated against a fixed set;
    details is free text, length-capped. Reporter id is attached when the
    viewer is signed in, otherwise the report is anonymous."""
    reason = (body.reason or "").strip().lower()
    if reason not in _ALLOWED_REASONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid reason. Allowed: {', '.join(sorted(_ALLOWED_REASONS))}.",
        )

    reporter_privy_id = None
    if current_user:
        reporter_privy_id = current_user.get("sub")

    row = {
        "project_id": body.project_id or None,
        "reporter_privy_id": reporter_privy_id,
        "reason": reason,
        "details": (body.details or "").strip()[:2000] or None,
    }

    try:
        get_client().table("content_reports").insert(row).execute()
    except Exception as exc:
        print(f"[reports] insert failed project={body.project_id}: {exc!r}")
        raise HTTPException(status_code=500, detail="Couldn't submit your report right now. Try again.")

    # Deliberately opaque success — don't leak whether/how reports are
    # actioned to a potential abuser.
    return {"ok": True}
