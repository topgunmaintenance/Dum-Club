import json
import os
from functools import lru_cache

import httpx
import jwt
from jwt.algorithms import ECAlgorithm, RSAAlgorithm
from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db.supabase import get_client

security = HTTPBearer(auto_error=False)

PRIVY_APP_ID = os.getenv("PRIVY_APP_ID")
_PRIVY_ISSUER = "privy.io"


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
        try:
            jwks = get_privy_jwks()
        except HTTPException:
            raise
        except Exception as e:
            print(f"[auth] JWKS fetch failed: {type(e).__name__}: {e}")
            raise HTTPException(status_code=503, detail="Failed to fetch JWKS")

        header = jwt.get_unverified_header(token)
        token_kid = header.get("kid")

        public_key = None
        for key in jwks.get("keys", []):
            if key.get("kid") == token_kid:
                key_json = json.dumps(key)
                kty = key.get("kty", "RSA")
                if kty == "EC":
                    public_key = ECAlgorithm.from_jwk(key_json)
                else:
                    public_key = RSAAlgorithm.from_jwk(key_json)
                break
        if not public_key:
            print(f"[auth] no matching key kid={token_kid!r}")
            raise HTTPException(status_code=401, detail="Invalid token key")

        try:
            payload = jwt.decode(
                token,
                public_key,
                algorithms=["ES256", "RS256"],
                audience=PRIVY_APP_ID,
                issuer=_PRIVY_ISSUER,
                options={"verify_exp": True},
            )
        except jwt.ExpiredSignatureError:
            print("[auth] token expired")
            raise HTTPException(status_code=401, detail="Token expired")
        except jwt.InvalidIssuerError:
            print("[auth] issuer mismatch")
            raise HTTPException(status_code=401, detail="Token issuer mismatch")
        except jwt.InvalidAudienceError:
            print("[auth] audience mismatch")
            raise HTTPException(status_code=401, detail="Token audience mismatch")
        except Exception as e:
            print(f"[auth] jwt.decode failed: {type(e).__name__}: {e}")
            raise HTTPException(status_code=401, detail=f"Token decode failed: {type(e).__name__}")

        return payload
    except HTTPException:
        raise
    except Exception as e:
        print(f"[auth] unexpected error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail="Token verification failed")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    return verify_privy_token(credentials.credentials)


def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict | None:
    """Like get_current_user but returns None for unauthenticated
    requests instead of raising 401.

    Used on endpoints that should accept both signed-in and guest
    visitors — most notably the Stripe checkout path, where a
    visitor can complete a purchase without a Privy account by
    relying on Stripe's email capture during checkout.

    A malformed / expired token still raises 401 (delegates to
    verify_privy_token) so we never silently treat a bad token as
    a guest — that path keeps existing behaviour for tampered
    credentials.
    """
    if not credentials:
        return None
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
