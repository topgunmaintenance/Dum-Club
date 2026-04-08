"""Auth endpoints — placeholder.

Topgun AI will ship SSO (OIDC / SAML) and SCIM in a later phase. This
module exposes a stub so the frontend can wire its AuthContext against a
stable shape from day one.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])


class CurrentUser(BaseModel):
    id: str
    name: str
    email: str
    role: str
    org: str


@router.get("/me", response_model=CurrentUser)
def me() -> CurrentUser:
    """Return a demo identity until SSO lands."""
    return CurrentUser(
        id="u_demo_mechanic",
        name="M. Alvarez",
        email="m.alvarez@topgun.ai",
        role="mechanic",
        org="Topgun Demo Operator",
    )
