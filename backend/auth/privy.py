import os
from functools import lru_cache

import httpx
import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db.supabase import get_client

security = HTTPBearer(auto_error=False)

PRIVY_APP_ID = os.getenv("PRIVY_APP_ID")


@lru_cache(maxsize=1)
def get_privy_jwks() -> dict:
    if not PRIVY_APP_ID:
        raise HTTPException(status_code=503, detail="PRIVY_APP_ID not configured")
    res = httpx.get(
        f"https://auth.privy.io/api/v1/apps/{PRIVY_APP_ID}/jwks.json",
        headers={"privy-app-id": PRIVY_APP_ID},
        timeout=10.0,
    )
    res.raise_for_status()
    return res.json()


def verify_privy_token(token: str) -> dict:
    if not PRIVY_APP_ID:
        raise HTTPException(status_code=503, detail="PRIVY_APP_ID not configured")
    try:
        jwks = get_privy_jwks()
        header = jwt.get_unverified_header(token)

        public_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == header.get("kid"):
                public_key = jwt.algorithms.RSAAlgorithm.from_jwk(key)
                break
        if not public_key:
            raise HTTPException(status_code=401, detail="Invalid token key")

        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=PRIVY_APP_ID,
            options={"verify_exp": True},
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
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
