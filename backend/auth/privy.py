import os
from functools import lru_cache

import httpx
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt

from db.supabase import get_client

security = HTTPBearer(auto_error=False)

PRIVY_APP_ID = (os.getenv("PRIVY_APP_ID") or "").strip()


@lru_cache(maxsize=1)
def get_privy_jwks() -> dict:
    """Fetch Privy JWKS once per process (per worker). Cached to avoid rate limits."""
    if not PRIVY_APP_ID:
        raise HTTPException(status_code=500, detail="PRIVY_APP_ID not configured")
    try:
        jwks_url = f"https://auth.privy.io/api/v1/apps/{PRIVY_APP_ID}/jwks.json"
        res = httpx.get(jwks_url, timeout=10.0)
        print("JWKS STATUS:", res.status_code)
        print("JWKS HEADERS:", dict(res.headers))
        print("JWKS BODY:", res.text)
        res.raise_for_status()
        return res.json()
    except httpx.HTTPStatusError as e:
        if e.response is not None and e.response.status_code == 429:
            raise HTTPException(
                status_code=503,
                detail="Privy verification temporarily rate-limited. Please retry shortly.",
            )
        raise HTTPException(
            status_code=401,
            detail=f"Could not load Privy signing keys: HTTP {e.response.status_code if e.response else '?'}",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Could not load Privy signing keys: {e}",
        )


def verify_privy_token(token: str) -> dict:
    if not PRIVY_APP_ID:
        raise HTTPException(status_code=500, detail="PRIVY_APP_ID not configured")

    jwks = get_privy_jwks()
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")

    signing_key = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            signing_key = key
            break

    if not signing_key:
        raise HTTPException(status_code=401, detail="Invalid token signing key")

    try:
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["ES256"],
            audience=PRIVY_APP_ID,
            options={"verify_at_hash": False, "verify_exp": True},
        )
        return claims
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return verify_privy_token(credentials.credentials)


def require_admin(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    payload = get_current_user(credentials)
    privy_id = payload.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    sb = get_client()
    result = (
        sb.table("users").select("is_admin").eq("privy_id", privy_id).single().execute()
    )
    if not result.data or not result.data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload
