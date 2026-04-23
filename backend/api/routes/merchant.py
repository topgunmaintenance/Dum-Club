"""
Merchant API — signup, Stripe Connect, Square OAuth, dashboard.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets as _py_secrets
import time
import urllib.parse

import httpx
import stripe
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional
from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

# Defensive .strip() on every Stripe env var. Railway's variable editor
# and common copy-paste flows from the Stripe dashboard frequently attach
# trailing whitespace or newlines. For Stripe OAuth specifically, a
# trailing \n on STRIPE_CONNECT_CLIENT_ID URL-encodes as %0A and makes
# Stripe reject the authorize request with "No application matches the
# supplied client identifier" — indistinguishable from a wrong client_id
# at a glance. Strip defensively at read time so no code path can ever
# forward whitespace to Stripe.
_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "").strip()
_STRIPE_CONNECT_CLIENT_ID = os.getenv("STRIPE_CONNECT_CLIENT_ID", "").strip()

_SQUARE_APP_ID = os.getenv("SQUARE_APPLICATION_ID", "").strip()
_SQUARE_APP_SECRET = os.getenv("SQUARE_APPLICATION_SECRET", "").strip()
_SQUARE_ENV = os.getenv("SQUARE_ENVIRONMENT", "sandbox").strip()

_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").strip()

# Stripe Connect OAuth redirect URI. MUST match a URI registered in the
# Stripe dashboard verbatim — Stripe rejects the OAuth request with
# "redirect_uri_mismatch" on any deviation (scheme, host, path, or even
# a stray trailing slash). Prod is registered as
#   https://dum.club/api/stripe/oauth/callback
# which is served by a thin Next.js route handler at
# frontend/app/api/stripe/oauth/callback/route.ts that 302-redirects the
# browser to the real hardened callback page at /merchant/stripe-callback.
# That indirection exists so the authenticated backend endpoint stays
# the source of truth for code exchange (with Privy bearer auth intact).
#
# Dev default falls back to the frontend-hosted path so local `next dev`
# picks up the route handler. Override per environment via env var —
# e.g. a preview Vercel alias.
_STRIPE_CONNECT_REDIRECT_URI = os.getenv(
    "STRIPE_CONNECT_REDIRECT_URI",
    "https://dum.club/api/stripe/oauth/callback",
).strip()


# ── Credential-pair diagnostic helper ───────────────────────────────
# Stripe's OAuth token exchange returns "Authorization code provided
# does not belong to you" when STRIPE_SECRET_KEY and
# STRIPE_CONNECT_CLIENT_ID come from different Stripe accounts — the
# authorize step issued the code against one account's Connect app,
# but the exchange is authenticated as a different account. From
# server logs alone this is indistinguishable from a transient Stripe
# error, so we log a non-sensitive fingerprint of both values at
# module load and again before each exchange attempt. Secret keys are
# reduced to "test" / "live" / "unknown"; client_ids show only the
# first 7 and last 6 chars (the full value is already public, it's
# sent verbatim in the authorize URL to Stripe).
def _stripe_secret_mode(key: str) -> str:
    if not key:
        return "empty"
    if key.startswith("sk_test_"):
        return "test"
    if key.startswith("sk_live_"):
        return "live"
    return "unknown"


def _stripe_client_id_fingerprint(cid: str) -> str:
    if not cid:
        return "empty"
    if not cid.startswith("ca_"):
        return f"malformed(prefix={cid[:3]!r}, len={len(cid)})"
    if len(cid) < 14:
        return f"short(len={len(cid)})"
    return f"{cid[:7]}...{cid[-6:]}(len={len(cid)})"


_STRIPE_SECRET_MODE_AT_BOOT = _stripe_secret_mode(_STRIPE_SECRET)
_STRIPE_CLIENT_ID_FP_AT_BOOT = _stripe_client_id_fingerprint(_STRIPE_CONNECT_CLIENT_ID)

print(
    f"[merchant] Stripe config @ startup: "
    f"secret_mode={_STRIPE_SECRET_MODE_AT_BOOT} "
    f"client_id_fp={_STRIPE_CLIENT_ID_FP_AT_BOOT} "
    f"redirect_uri={_STRIPE_CONNECT_REDIRECT_URI}"
)
if _STRIPE_SECRET_MODE_AT_BOOT == "unknown" and _STRIPE_SECRET:
    print("[merchant] WARNING: STRIPE_SECRET_KEY is set but doesn't match sk_test_* or sk_live_* — malformed?")
if not _STRIPE_CONNECT_CLIENT_ID.startswith("ca_") and _STRIPE_CONNECT_CLIENT_ID:
    print("[merchant] WARNING: STRIPE_CONNECT_CLIENT_ID is set but doesn't start with ca_ — malformed?")

# ── OAuth state signing ─────────────────────────────────────────────
# HMAC-signed state tokens for the Stripe Connect OAuth flow. Replaces
# the old implementation that used a raw Privy DID as state — which was
# vulnerable to the OAuth confused-deputy attack: any attacker who knew a
# victim's Privy DID could initiate OAuth with their own Stripe account,
# use state=<victim's DID>, and the callback would attach the attacker's
# stripe_user_id to the victim's merchants row. Every subsequent customer
# payment for the victim's storefront would route to the attacker.
#
# Mitigation: bind the state token to the initiating user via HMAC,
# enforce a short TTL, and additionally require the callback to carry a
# valid Privy auth token whose `sub` matches the state's privy_id. Both
# checks must pass — belt-and-suspenders against session theft and
# phishing.
#
# Secret source (priority order):
#   1. OAUTH_STATE_SECRET — purpose-specific, safest to rotate alone
#   2. STRIPE_WEBHOOK_SECRET — already provisioned in Railway for HMAC
#      use, reasonable fallback
#   3. Process-lifetime random — only for local dev; state tokens
#      become invalid on every restart. Dockerfile runs --workers 1 so
#      this is safe in single-container deploys.
_OAUTH_STATE_TTL_SECONDS = 600  # 10 minutes — OAuth round-trips finish fast

_OAUTH_STATE_SECRET: str = (
    os.getenv("OAUTH_STATE_SECRET", "").strip()
    or os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    or _py_secrets.token_hex(32)
)


def _make_oauth_state(privy_id: str) -> str:
    """
    Issue a tamper-evident state token for the OAuth authorize step.

    Format: `{privy_id}.{unix_ts}.{hmac_sha256_hex}`. Privy DIDs contain
    colons but no periods, so splitting on '.' is safe; the HMAC hex is
    URL-safe as-is.
    """
    ts = str(int(time.time()))
    payload = f"{privy_id}|{ts}"
    sig = hmac.new(
        _OAUTH_STATE_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{privy_id}.{ts}.{sig}"


def _verify_oauth_state(state: str, expected_privy_id: str) -> None:
    """
    Verify a state token from the OAuth callback.

    Raises `HTTPException(403, ...)` with a stable error code if the state
    is malformed, tampered, expired, or bound to a different user. Returns
    None on success.

    Defenses:
      - Signature mismatch → token was tampered or signed by a different
        server; reject.
      - Age > TTL → replay of an old token; reject.
      - Negative age beyond small clock skew → manufactured future
        timestamp; reject.
      - privy_id mismatch → attacker tried to reuse someone else's state
        against their own session; reject.

    Uses `hmac.compare_digest` for constant-time signature comparison to
    avoid timing-based secret extraction.
    """
    if not state:
        raise HTTPException(status_code=403, detail="oauth_state_missing")

    parts = state.split(".")
    if len(parts) != 3:
        raise HTTPException(status_code=403, detail="oauth_state_malformed")
    privy_id_in_state, ts_str, sig_hex = parts

    try:
        ts = int(ts_str)
    except ValueError:
        raise HTTPException(status_code=403, detail="oauth_state_malformed")

    payload = f"{privy_id_in_state}|{ts_str}"
    expected_sig = hmac.new(
        _OAUTH_STATE_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig_hex, expected_sig):
        raise HTTPException(status_code=403, detail="oauth_state_signature_invalid")

    now = int(time.time())
    age = now - ts
    if age > _OAUTH_STATE_TTL_SECONDS:
        raise HTTPException(status_code=403, detail="oauth_state_expired")
    if age < -60:
        # Small negative tolerance for clock skew between workers; anything
        # further in the future was manufactured.
        raise HTTPException(status_code=403, detail="oauth_state_future")

    if privy_id_in_state != expected_privy_id:
        raise HTTPException(status_code=403, detail="oauth_state_user_mismatch")


# ── Founding merchant program ──────────────────────────────────────
# Total cap for the founding program. Source of truth for both the
# slot assignment during signup and the /founding-status counter.
# CLAUDE.md Section 7 is kept in sync with this value.
FOUNDING_CAP = 100


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

def _count_active_founding(supabase) -> int:
    """Count active merchants currently on the founding plan."""
    res = (
        supabase.table("merchants")
        .select("id", count="exact")
        .eq("plan_type", "founding")
        .eq("active", True)
        .execute()
    )
    # Supabase Python client returns `count` when count="exact" is set.
    if getattr(res, "count", None) is not None:
        return int(res.count or 0)
    return len(res.data or [])


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

    # Atomic-ish founding slot assignment. Supabase/PostgREST doesn't give us a
    # SQL transaction handle, so we:
    #   1. Fetch the current max founding_slot_number
    #   2. Attempt INSERT with that value + 1 under the partial unique index
    #      idx_merchants_founding_slot
    #   3. Retry a small number of times if a concurrent signup collides
    # Over the cap → fall through to the 'standard' plan.
    row_base = {
        "owner_privy_id": privy_id,
        "business_profile_id": bp_id,
        "business_name": body.business_name,
        "business_type": body.business_type,
        "location_city": body.location_city,
        "location_state": body.location_state,
        "subscription_price_usd": 0,
        "platform_fee_percent": 0,
    }

    inserted = None
    last_error = None
    max_attempts = 5

    for _ in range(max_attempts):
        founding_count = _count_active_founding(supabase)

        if founding_count >= FOUNDING_CAP:
            # Cap hit — onboard as standard plan. Pricing is config-driven
            # on the frontend; backend defaults to 0 until Stripe billing
            # is wired up in a future PR.
            row = {
                **row_base,
                "founding_merchant": False,
                "subscription_tier": "standard",
                "plan_type": "standard",
                "subscription_status": "active",
                "founding_slot_number": None,
            }
            try:
                res = supabase.table("merchants").insert(row).execute()
                if res.data:
                    inserted = res.data[0]
                    break
            except Exception as exc:
                last_error = exc
                continue

        # Founding path — compute the next slot number from current max.
        # The partial unique index idx_merchants_founding_slot will reject
        # collisions; we retry on duplicate-key errors.
        slot_res = (
            supabase.table("merchants")
            .select("founding_slot_number")
            .order("founding_slot_number", desc=True)
            .not_.is_("founding_slot_number", "null")
            .limit(1)
            .execute()
        )
        current_max = 0
        if slot_res.data and slot_res.data[0].get("founding_slot_number") is not None:
            current_max = int(slot_res.data[0]["founding_slot_number"])
        next_slot = current_max + 1

        if next_slot > FOUNDING_CAP:
            # Race: someone filled the last slot between count and max query.
            continue

        row = {
            **row_base,
            "founding_merchant": True,
            "subscription_tier": "founding",
            "plan_type": "founding",
            "subscription_status": "active",
            "founding_slot_number": next_slot,
        }

        try:
            res = supabase.table("merchants").insert(row).execute()
            if res.data:
                inserted = res.data[0]
                break
        except Exception as exc:
            # Most likely a unique-key collision on founding_slot_number —
            # re-loop and try the next slot.
            last_error = exc
            continue

    if not inserted:
        detail = "Failed to create merchant"
        if last_error is not None:
            detail = f"{detail}: {last_error!r}"
        raise HTTPException(status_code=500, detail=detail)

    return {"merchant": inserted, "created": True}


# ── Founding status (public) ──

@router.get("/founding-status")
async def get_founding_status():
    """Public endpoint: how many founding slots are left.

    Returns:
      {
        "founding_slots_remaining": int,   # max(0, FOUNDING_CAP - current count)
        "total_cap": int,                  # FOUNDING_CAP
        "founding_program_open": bool,     # true if slots_remaining > 0
      }

    No auth required — this drives the "X of 100 spots remaining" counter
    on the /merchant signup page, which non-authenticated visitors see.
    """
    try:
        supabase = get_client()
        taken = _count_active_founding(supabase)
    except Exception as exc:
        print(f"[merchant] founding-status error: {exc!r}")
        # Graceful fallback — surface the cap without failing the page.
        return {
            "founding_slots_remaining": FOUNDING_CAP,
            "total_cap": FOUNDING_CAP,
            "founding_program_open": True,
        }

    remaining = max(0, FOUNDING_CAP - taken)
    return {
        "founding_slots_remaining": remaining,
        "total_cap": FOUNDING_CAP,
        "founding_program_open": remaining > 0,
    }


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

    # redirect_uri MUST match the value registered in the Stripe Connect
    # dashboard verbatim. Env-overridable so preview environments can
    # point at their own host without code changes. See the comment on
    # _STRIPE_CONNECT_REDIRECT_URI for the full flow.
    redirect_uri = _STRIPE_CONNECT_REDIRECT_URI

    # Pre-authorize diag. Mirrors the same fingerprint we log before
    # token exchange so any credential drift between the two steps is
    # visible in a single log grep.
    print(
        f"[stripe-connect/authorize] building URL: "
        f"privy_id=...{privy_id[-6:]} "
        f"secret_mode={_stripe_secret_mode(_STRIPE_SECRET)} "
        f"client_id_fp={_stripe_client_id_fingerprint(_STRIPE_CONNECT_CLIENT_ID)} "
        f"redirect_uri={redirect_uri}"
    )

    # state is an HMAC-signed token bound to this privy_id with a 10-min
    # TTL. The callback verifies the signature and additionally requires
    # the caller to be authenticated as the same privy_id.
    params = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": _STRIPE_CONNECT_CLIENT_ID,
        "scope": "read_write",
        "redirect_uri": redirect_uri,
        "state": _make_oauth_state(privy_id),
    })
    url = f"https://connect.stripe.com/oauth/authorize?{params}"
    return {"url": url}


@router.get("/stripe-connect/status")
async def stripe_connect_status(current_user: dict = Depends(get_current_user)):
    """
    Live status of the caller's Stripe Connect account.

    Source of truth: Stripe. We do a fresh Account.retrieve on every
    call so the merchant UI never shows stale "connected" while the
    real account state is still pending identity review. Side-effect:
    write the computed status back to merchants.stripe_connect_status
    so downstream callers (checkout guards, dashboards) don't need to
    re-hit Stripe for the cached read.

    Returns a stable shape the frontend can render without Stripe-
    specific knowledge:

      {
        "status": "not_connected" | "pending_verification"
                 | "verified" | "restricted",
        "charges_enabled": bool,
        "payouts_enabled": bool,
        "requirements_currently_due": [str, ...],
        "disabled_reason": str | null,
        "stripe_connect_id": str | null,
      }
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    merchant = _get_merchant_or_404(privy_id)
    connect_id = merchant.get("stripe_connect_id")
    if not connect_id:
        return {
            "status": "not_connected",
            "charges_enabled": False,
            "payouts_enabled": False,
            "requirements_currently_due": [],
            "disabled_reason": None,
            "stripe_connect_id": None,
        }

    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")
    stripe.api_key = _STRIPE_SECRET

    try:
        account = stripe.Account.retrieve(connect_id)
    except Exception as exc:
        print(f"[merchant] stripe-connect/status Account.retrieve failed for {connect_id}: {exc!r}")
        raise HTTPException(status_code=502, detail="stripe_account_retrieve_failed")

    charges_enabled = bool(getattr(account, "charges_enabled", False))
    payouts_enabled = bool(getattr(account, "payouts_enabled", False))
    requirements = getattr(account, "requirements", None)
    currently_due: list[str] = []
    disabled_reason: Optional[str] = None
    if requirements is not None:
        currently_due = list(getattr(requirements, "currently_due", []) or [])
        disabled_reason = getattr(requirements, "disabled_reason", None) or None

    if disabled_reason:
        new_status = "restricted"
    elif charges_enabled and not currently_due:
        new_status = "verified"
    else:
        new_status = "pending_verification"

    # Write-through cache so the merchants row stays fresh without
    # waiting for the account.updated webhook.
    try:
        supabase = get_client()
        supabase.table("merchants").update({
            "stripe_connect_status": new_status,
        }).eq("owner_privy_id", privy_id).execute()
    except Exception as exc:
        print(f"[merchant] stripe-connect/status write-through failed: {exc!r}")

    return {
        "status": new_status,
        "charges_enabled": charges_enabled,
        "payouts_enabled": payouts_enabled,
        "requirements_currently_due": currently_due,
        "disabled_reason": disabled_reason,
        "stripe_connect_id": connect_id,
    }


@router.get("/stripe-connect/callback")
async def stripe_connect_callback(
    code: str,
    state: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Exchange a Stripe Connect OAuth code for a connected account id.

    Security: the caller MUST be authenticated via Privy (Depends on
    get_current_user), AND the state token MUST be an HMAC-signed token
    bound to the same authenticated privy_id. Without these, an attacker
    with a victim's Privy DID could craft a OAuth round-trip that attaches
    the attacker's Stripe account to the victim's merchants row, then
    collect all payments meant for the victim's storefront.

    The callback writes ONLY to the authenticated user's own merchants
    row — we never trust `state` to identify the user anymore; the Privy
    token is the identity source of truth.
    """
    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")

    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    # Gate 1: HMAC state token must be valid and bound to this user.
    # Raises 403 with a stable code on any failure mode.
    _verify_oauth_state(state, privy_id)

    stripe.api_key = _STRIPE_SECRET

    # Pre-exchange diagnostic. Prints a non-sensitive fingerprint of
    # the credential pair every time we call Stripe. Lets us spot
    # "code doesn't belong to you" as an account / mode mismatch vs a
    # transient Stripe issue without re-reading env.
    secret_mode = _stripe_secret_mode(_STRIPE_SECRET)
    client_id_fp = _stripe_client_id_fingerprint(_STRIPE_CONNECT_CLIENT_ID)
    print(
        f"[stripe-connect/callback] pre-exchange diag: "
        f"privy_id=...{privy_id[-6:] if privy_id else 'none'} "
        f"secret_mode={secret_mode} client_id_fp={client_id_fp} "
        f"code_prefix={code[:6] if code else 'empty'}..."
    )

    try:
        resp = stripe.OAuth.token(grant_type="authorization_code", code=code)
    except stripe.oauth_error.OAuthError as e:
        # "Authorization code provided does not belong to you" means the
        # SECRET KEY's Stripe account doesn't own the Connect app that
        # issued this code. Usually: STRIPE_CONNECT_CLIENT_ID and
        # STRIPE_SECRET_KEY are from different Stripe accounts.
        print(
            f"[stripe-connect/callback] OAuth token exchange FAILED: "
            f"error_type={type(e).__name__} "
            f"user_message={e.user_message!r} "
            f"secret_mode={secret_mode} client_id_fp={client_id_fp}"
        )
        raise HTTPException(status_code=400, detail=f"Stripe Connect failed: {e.user_message}")
    except Exception as e:
        print(
            f"[stripe-connect/callback] OAuth token exchange CRASHED: "
            f"error_type={type(e).__name__} "
            f"secret_mode={secret_mode} client_id_fp={client_id_fp}"
        )
        raise

    connected_account_id = resp.get("stripe_user_id")
    if not connected_account_id:
        raise HTTPException(status_code=400, detail="No account ID returned from Stripe")

    # Gate 2: the merchants row we write to is keyed by the authenticated
    # user's privy_id, never by any value supplied in `state`. Even if
    # Gate 1 were somehow bypassed, this keeps an attacker's connect id
    # attached only to their own merchants row.
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
