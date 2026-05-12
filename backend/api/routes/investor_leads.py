"""
Investor lead capture — public POST endpoint backing the
"Join Investor Updates" form on /investors. One row per
opt-in. Re-submits from the same email are accepted but
do not insert duplicate rows (UNIQUE INDEX on lower(email)).

Migration 041 owns the table shape.
"""
import re
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, EmailStr

from db.supabase import get_client

router = APIRouter()


# Anchored RFC-5322-lite email regex. We use this as a safety net
# on top of pydantic's EmailStr, which can be too permissive about
# unusual TLDs. Belt + suspenders for a public, unauthenticated
# endpoint.
_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$"
)


class InvestorLeadIn(BaseModel):
    email: EmailStr
    source: Optional[str] = "investors_page"


@router.post("")
async def create_investor_lead(
    body: InvestorLeadIn,
    user_agent: Optional[str] = Header(default=None, alias="user-agent"),
    referer: Optional[str] = Header(default=None, alias="referer"),
):
    email = str(body.email).strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email")

    supabase = get_client()
    # ON CONFLICT (lower(email)) DO NOTHING — modelled in the
    # supabase-py client as upsert with the existing UNIQUE INDEX
    # as the conflict target. We don't bubble the conflict up: the
    # caller sees a 200 either way, so the buyer doesn't have to
    # remember whether they signed up before.
    try:
        supabase.table("investor_leads").insert(
            {
                "email": email,
                "source": (body.source or "investors_page")[:64],
                "user_agent": (user_agent or "")[:512] or None,
                "referrer": (referer or "")[:1024] or None,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001 — DB layer surfaces strings
        msg = str(exc)
        # Postgres duplicate-key error from the UNIQUE INDEX. Swallow
        # so repeat opt-ins look like success to the user.
        if "duplicate key" in msg.lower() or "23505" in msg:
            return {"status": "ok", "deduped": True}
        # Other failures are real — return 503 so the client shows
        # a retry message instead of pretending it worked.
        print(f"[investor_leads] insert failed: {msg}")
        raise HTTPException(status_code=503, detail="Could not record signup")

    return {"status": "ok"}
