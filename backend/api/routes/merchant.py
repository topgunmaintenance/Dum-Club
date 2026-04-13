"""
Merchant API — signup, Stripe Connect, Square OAuth, dashboard.
"""

from __future__ import annotations

import os
import urllib.parse

import httpx
import stripe
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "")
_STRIPE_CONNECT_CLIENT_ID = os.getenv("STRIPE_CONNECT_CLIENT_ID", "")

_SQUARE_APP_ID = os.getenv("SQUARE_APPLICATION_ID", "")
_SQUARE_APP_SECRET = os.getenv("SQUARE_APPLICATION_SECRET", "")
_SQUARE_ENV = os.getenv("SQUARE_ENVIRONMENT", "sandbox")

_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")


class MerchantSignup(BaseModel):
    business_name: str
    business_type: Optional[str] = None
    location_city: Optional[str] = None
    location_state: Optional[str] = None


# ── Helpers ──

def _get_merchant_or_404(privy_id: str):
    supabase = get_client()
    res = (
        supabase.table("merchants")
        .select("*")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Merchant not found — sign up first")
    return res.data[0]


# ── Signup ──

@router.post("/signup")
async def merchant_signup(body: MerchantSignup, current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

    # Check if merchant already exists
    existing = (
        supabase.table("merchants")
        .select("*")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"merchant": existing.data[0], "created": False}

    # Link to existing business_profile if one exists
    bp_id = None
    bp = (
        supabase.table("business_profiles")
        .select("id")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if bp.data:
        bp_id = bp.data[0]["id"]

    row = {
        "owner_privy_id": privy_id,
        "business_profile_id": bp_id,
        "business_name": body.business_name,
        "business_type": body.business_type,
        "location_city": body.location_city,
        "location_state": body.location_state,
        "founding_merchant": True,
        "subscription_tier": "founding",
        "subscription_price_usd": 0,
        "platform_fee_percent": 0,
    }

    res = supabase.table("merchants").insert(row).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create merchant")

    return {"merchant": res.data[0], "created": True}


# ── Get my merchant record ──

@router.get("/me")
async def get_my_merchant(current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()
    res = (
        supabase.table("merchants")
        .select("*")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return {"merchant": None}
    return {"merchant": res.data[0]}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# STRIPE CONNECT
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.get("/stripe-connect/authorize")
async def stripe_connect_authorize(current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    if not _STRIPE_CONNECT_CLIENT_ID:
        raise HTTPException(status_code=503, detail="STRIPE_CONNECT_CLIENT_ID not configured")

    _get_merchant_or_404(privy_id)

    redirect_uri = f"{_FRONTEND_URL}/merchant/stripe-callback"
    params = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": _STRIPE_CONNECT_CLIENT_ID,
        "scope": "read_write",
        "redirect_uri": redirect_uri,
        "state": privy_id,
    })
    url = f"https://connect.stripe.com/oauth/authorize?{params}"
    return {"url": url}


@router.get("/stripe-connect/callback")
async def stripe_connect_callback(code: str, state: str):
    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")

    stripe.api_key = _STRIPE_SECRET

    try:
        resp = stripe.OAuth.token(grant_type="authorization_code", code=code)
    except stripe.oauth_error.OAuthError as e:
        raise HTTPException(status_code=400, detail=f"Stripe Connect failed: {e.user_message}")

    connected_account_id = resp.get("stripe_user_id")
    if not connected_account_id:
        raise HTTPException(status_code=400, detail="No account ID returned from Stripe")

    privy_id = state
    supabase = get_client()
    supabase.table("merchants").update({
        "stripe_connect_id": connected_account_id,
        "stripe_connect_status": "connected",
    }).eq("owner_privy_id", privy_id).execute()

    return {"connected": True, "stripe_connect_id": connected_account_id}


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SQUARE OAUTH
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

@router.get("/square/authorize")
async def square_authorize(current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    if not _SQUARE_APP_ID:
        raise HTTPException(status_code=503, detail="SQUARE_APPLICATION_ID not configured")

    _get_merchant_or_404(privy_id)

    base = "https://connect.squareupsandbox.com" if _SQUARE_ENV == "sandbox" else "https://connect.squareup.com"
    redirect_uri = f"{_FRONTEND_URL}/merchant/square-callback"
    params = urllib.parse.urlencode({
        "client_id": _SQUARE_APP_ID,
        "scope": "MERCHANT_PROFILE_READ PAYMENTS_READ ORDERS_READ ITEMS_READ",
        "session": "false",
        "state": privy_id,
        "redirect_uri": redirect_uri,
    })
    url = f"{base}/oauth2/authorize?{params}"
    return {"url": url}


@router.get("/square/callback")
async def square_callback(code: str, state: str):
    if not _SQUARE_APP_ID or not _SQUARE_APP_SECRET:
        raise HTTPException(status_code=503, detail="Square credentials not configured")

    base_api = "https://connect.squareupsandbox.com" if _SQUARE_ENV == "sandbox" else "https://connect.squareup.com"

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            f"{base_api}/oauth2/token",
            json={
                "client_id": _SQUARE_APP_ID,
                "client_secret": _SQUARE_APP_SECRET,
                "code": code,
                "grant_type": "authorization_code",
            },
        )

    if token_resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Square token exchange failed: {token_resp.text}")

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="No access token returned from Square")

    # Fetch merchant locations
    location_id = None
    async with httpx.AsyncClient() as client:
        loc_resp = await client.get(
            f"{base_api}/v2/locations",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if loc_resp.status_code == 200:
        locations = loc_resp.json().get("locations", [])
        if locations:
            location_id = locations[0].get("id")

    privy_id = state
    supabase = get_client()
    supabase.table("merchants").update({
        "square_location_id": location_id,
        "square_access_token_enc": access_token,  # TODO: encrypt at rest
        "square_status": "connected",
    }).eq("owner_privy_id", privy_id).execute()

    return {"connected": True, "location_id": location_id}
