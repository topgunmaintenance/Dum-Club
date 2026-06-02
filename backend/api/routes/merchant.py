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
from services.seed_claim import maybe_claim_seed_profiles
from services.subscriptions import (
    create_trial_subscription,
    cancel_subscription,
)
from services.live_limits import check_rate_limit

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
    # Tier selected on /pricing or /upgrade. Optional; defaults to "growth"
    # when absent or unrecognised. Validated against the allowed set at
    # signup time (any value outside {starter, growth, pro} falls back to
    # growth rather than failing the signup — UI typos shouldn't lock a
    # real merchant out of getting set up).
    tier: Optional[str] = None


# Allowed self-serve tiers. Business / Enterprise are quote-only and never
# reachable from the signup flow — they're set up manually in the Stripe
# Dashboard after a contract is signed.
_ALLOWED_SIGNUP_TIERS = {"starter", "growth", "pro"}


def _slugify_business_name(name: str) -> str:
    """Lowercase, alphanumeric+hyphens only, collapsed, max 50 chars.
    Empty string if the input has no alphanumeric chars."""
    if not name:
        return ""
    import re as _re
    s = _re.sub(r"[^a-z0-9]+", "-", name.lower())
    s = _re.sub(r"-+", "-", s).strip("-")
    return s[:50]


def _create_storefront_project(
    supabase, *, privy_id: str, business_name: str, business_profile_id: Optional[str],
) -> Optional[dict]:
    """Insert a `projects` row tied to this merchant so the rest of the
    dashboard ("Add your first offer", install snippet, Go Live) has
    something to attach to.

    Slug collision strategy: try the slugified business name, then
    `slug-2` ... `slug-5`, then fall back to `slug-<last-8-chars-of-privy_id>`.
    Returns the inserted row, or None on total failure (caller treats as
    non-fatal — merchant can still complete signup, the project gets
    backfilled on next /api/merchant/me hit).

    Defaults match CLAUDE.md doctrine: status='draft' so it doesn't show
    on Discover until the merchant actually goes live; review_status
    'pending' until the operator approves; no token (token_status='inactive').
    """
    base_slug = _slugify_business_name(business_name) or "merchant"
    candidates = [base_slug] + [f"{base_slug}-{n}" for n in range(2, 6)]
    candidates.append(f"{base_slug}-{(privy_id or '')[-8:].lower()}")

    title = (business_name or "").strip() or "My Storefront"
    base_row = {
        "name": title,
        "title": title,
        "description": "",
        "category": "service",
        "template_type": "local_service",
        "status": "draft",
        "review_status": "pending",
        "visibility": "public",
        "is_deleted": False,
        "verified": False,
        "is_verified": False,
        "profile_strength": 10,
        "privy_id": privy_id,
        "business_profile_id": business_profile_id,
        "token_status": "inactive",
    }

    for slug in candidates:
        try:
            res = (
                supabase.table("projects")
                .insert({**base_row, "slug": slug})
                .execute()
            )
            if res.data:
                print(f"[merchant/signup] created storefront project slug={slug} for privy={privy_id[-6:]}")
                return res.data[0]
        except Exception as exc:
            # Unique-key violation on slug → try the next candidate.
            msg = repr(exc).lower()
            is_dup = "23505" in msg or "duplicate" in msg or "unique" in msg
            if is_dup:
                continue
            # Non-duplicate failure (e.g. constraint we haven't anticipated)
            # — log and bail. The merchant signup itself still succeeds.
            print(f"[merchant/signup] project insert failed slug={slug}: {exc!r}")
            return None
    print(f"[merchant/signup] all slug candidates collided for privy={privy_id[-6:]} — skipped project create")
    return None


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

    # ── Storefront project auto-create ────────────────────────────
    # The /merchant launch checklist ("Add your first offer", "Paste the
    # snippet", "Go Live") all need a project row to attach to. Without
    # this auto-create, brand-new merchants land in a dead end where the
    # "Add offer" button can't render because firstProject is null and
    # no UI exists to create the project explicitly. Best-effort: if the
    # insert fails we still return the merchant row; the project gets
    # backfilled on the next GET /api/merchant/me hit.
    try:
        project_row = _create_storefront_project(
            supabase,
            privy_id=privy_id,
            business_name=body.business_name,
            business_profile_id=bp_id,
        )
        if project_row:
            inserted["_storefront_project_id"] = project_row.get("id")
            inserted["_storefront_project_slug"] = project_row.get("slug")
    except Exception as exc:
        print(f"[merchant/signup] storefront project create raised: {exc!r}")

    # ── 60-day trial provisioning ─────────────────────────────────
    # Founding-100 merchants are grandfathered into $0-forever pricing per
    # CLAUDE.md doctrine and skip the trial flow entirely. Non-founding
    # signups get a Stripe Subscription with trial_period_days=60 and
    # pause-on-missing-payment-method, so no card is required at signup.
    #
    # Best-effort: a Stripe outage here doesn't fail the signup. The merchant
    # lands in the dashboard, the trial banner shows "Setting up your trial.."
    # state, and a follow-up dashboard load can call this code path again
    # (gated by stripe_subscription_id IS NULL) to retry.
    if not inserted.get("founding_merchant"):
        # Look up the merchant's cached email from users.email — sync writes
        # it on every Privy session, so first-signup callers have it.
        user_email: Optional[str] = None
        try:
            user_res = (
                supabase.table("users")
                .select("email")
                .eq("privy_id", privy_id)
                .limit(1)
                .execute()
            )
            if user_res.data:
                user_email = (user_res.data[0] or {}).get("email")
        except Exception as exc:
            print(f"[merchant/signup] email lookup failed: {exc!r}")

        # Resolve the tier the merchant actually picked on /pricing or
        # /upgrade. Validate against the allowed self-serve set; anything
        # missing or unrecognised falls back to growth (the historical
        # default). Validation here is generous on purpose — a UI typo
        # shouldn't fail signup, it should just land on growth.
        requested_tier = (body.tier or "").strip().lower()
        resolved_tier = requested_tier if requested_tier in _ALLOWED_SIGNUP_TIERS else "growth"
        if requested_tier and requested_tier != resolved_tier:
            print(
                f"[merchant/signup] ignoring unrecognised tier={requested_tier!r}, "
                f"falling back to {resolved_tier}"
            )

        trial = create_trial_subscription(
            privy_id=privy_id,
            email=user_email,
            business_name=body.business_name,
            tier=resolved_tier,
        )
        if not trial.get("error"):
            try:
                trial_update = {
                    "stripe_customer_id": trial.get("stripe_customer_id"),
                    "stripe_subscription_id": trial.get("stripe_subscription_id"),
                    "subscription_price_id": trial.get("subscription_price_id"),
                    "trial_start_at": trial.get("trial_start_at"),
                    "trial_ends_at": trial.get("trial_ends_at"),
                    "next_billing_at": trial.get("next_billing_at"),
                    "subscription_status": trial.get("subscription_status") or "trialing",
                    "grandfathered": False,
                }
                # Drop None values so we don't overwrite real columns with NULL
                # if Stripe gave us a partial response.
                trial_update = {k: v for k, v in trial_update.items() if v is not None}
                supabase.table("merchants").update(trial_update).eq(
                    "id", inserted["id"]
                ).execute()
                inserted.update(trial_update)
            except Exception as exc:
                print(f"[merchant/signup] trial write-through failed: {exc!r}")
        else:
            print(f"[merchant/signup] trial provisioning skipped: {trial.get('error')}")
    else:
        # Grandfather founding rows so the cron + dashboard banner skip them.
        try:
            supabase.table("merchants").update({"grandfathered": True}).eq(
                "id", inserted["id"]
            ).execute()
            inserted["grandfathered"] = True
        except Exception as exc:
            print(f"[merchant/signup] grandfather write failed: {exc!r}")

    return {"merchant": inserted, "created": True}


# ── Founding status (public) ──

@router.get("/founding-status")
async def get_founding_status(request: Request):
    """Public endpoint: is the founding-100 program still open?

    Returns:
      { "founding_program_open": bool }

    No auth required — drives CTA-copy toggles on /merchant and /business
    (e.g. "Claim a Founding Spot" vs "Join the Waitlist") for visitors
    who aren't signed in yet.

    Rate-limited at 30 requests / minute / client-IP via the in-memory
    sliding-window in services/live_limits. Polling-based scrapers
    trying to time the program-open transition get a 429 well before
    they can build a useful signal; legitimate page loads (1 hit
    per visitor per page render) never come near the cap. The
    in-memory bucket resets on Railway restart, which is the
    acceptable trade-off for an anti-scrape posture without
    introducing Redis or a new rate-limit dep.

    HISTORY: previously also returned `founding_slots_remaining` and
    `total_cap` to drive a "X of 100 spots claimed" scarcity pill on the
    public pages. Founder direction (PR removing public founding-counter
    surfaces) is to NOT surface live merchant-count traction to
    visitors / competitors during the founding ramp. The count fields
    were dropped from the response so a determined competitor cannot
    curl the endpoint to derive the same number we hid from the UI.

    For internal use (admin dashboard, founder reports), query
    merchants directly via the service-role Supabase client or add a
    separate admin-gated endpoint — DO NOT re-add the count to this
    public response.
    """
    # Soft rate limit by client IP. X-Forwarded-For first hop is the
    # real client behind Vercel / Railway proxies; fall back to
    # X-Real-IP, then request.client.host, then a literal "unknown"
    # bucket for the pathological no-headers case (all such requests
    # share one bucket, which is fine for anti-scrape posture).
    try:
        xff = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        real_ip = request.headers.get("x-real-ip", "").strip()
        client_ip = (
            xff
            or real_ip
            or (request.client.host if request.client else "")
            or "unknown"
        )
        err = check_rate_limit(client_ip, "founding-status", 30)
        if err:
            raise HTTPException(status_code=429, detail=err)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        # Rate-limit check itself failed (in-memory dict corruption,
        # late-import error, etc). Fail open so the public CTA path
        # doesn't break on a defensive-layer bug.
        print(f"[merchant] founding-status rate-limit check failed: {exc!r}")

    try:
        supabase = get_client()
        taken = _count_active_founding(supabase)
    except Exception as exc:
        print(f"[merchant] founding-status error: {exc!r}")
        # Graceful fallback — assume open so the public CTA doesn't
        # flip to "Join the Waitlist" during a transient Supabase blip.
        return {"founding_program_open": True}

    remaining = max(0, FOUNDING_CAP - taken)
    return {"founding_program_open": remaining > 0}


# ── Get my merchant record ──

@router.get("/me")
async def get_my_merchant(current_user: dict = Depends(get_current_user)):
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    # Belt + suspenders: if the user signed in via a path that
    # bypassed /api/auth/sync (rare but possible during dev),
    # the auto-claim attempt here covers the case where their
    # email matches a seed business_profiles row.
    try:
        maybe_claim_seed_profiles(privy_id)
    except Exception as claim_exc:
        print(f"[merchant/me] auto-claim failed: {claim_exc!r}")

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

    merchant_row = res.data[0]

    # Backfill: legacy merchants signed up before auto-create-storefront
    # have a merchants row but no projects row, so the dashboard checklist
    # dead-ends at "Add your first offer". Create the project on the fly.
    # Best-effort; failures are silent because the merchant fetch itself
    # is the primary purpose of this endpoint.
    try:
        existing_proj = (
            supabase.table("projects")
            .select("id")
            .eq("privy_id", privy_id)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if not existing_proj.data:
            _create_storefront_project(
                supabase,
                privy_id=privy_id,
                business_name=merchant_row.get("business_name") or "",
                business_profile_id=merchant_row.get("business_profile_id"),
            )
    except Exception as exc:
        print(f"[merchant/me] storefront backfill check failed: {exc!r}")

    return {"merchant": merchant_row}


# ── 60-day trial status (dashboard countdown) ──

# Plan price labels keyed off the cached subscription_price_id. Read-side
# only — Stripe is authoritative for the actual charge amount; this map is
# for the dashboard banner copy ("$99/month plan starts on..."). Source of
# truth for tier prices: CLAUDE.md v5 §3.
_PRICE_LABEL_FROM_ENV = {
    os.getenv("STRIPE_PRICE_ID_STARTER"): ("Starter", 39),
    os.getenv("STRIPE_PRICE_ID_GROWTH"): ("Growth", 99),
    os.getenv("STRIPE_PRICE_ID_PRO"): ("Pro", 299),
}


def _days_until(iso_ts: Optional[str]) -> Optional[int]:
    """Return whole days from now to the given ISO timestamp. Negative if past."""
    if not iso_ts:
        return None
    try:
        from datetime import datetime, timezone
        target = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if target.tzinfo is None:
            target = target.replace(tzinfo=timezone.utc)
        delta = target - datetime.now(timezone.utc)
        return int(delta.total_seconds() // 86400)
    except Exception:
        return None


@router.get("/trial-status")
async def get_trial_status(current_user: dict = Depends(get_current_user)):
    """
    Trial countdown payload for the dashboard banner. Pure read endpoint —
    serves cached fields from the merchants row; no Stripe calls. Webhooks
    keep the cache fresh.

    Returns:
      {
        "has_merchant": bool,
        "grandfathered": bool,        # True = no trial, no auto-convert
        "subscription_status": str | None,
        "trial_ends_at": str | None,  # ISO timestamp
        "days_remaining": int | None, # negative when trial has ended
        "next_billing_at": str | None,
        "plan_label": str | None,     # "Starter" | "Growth" | "Pro"
        "plan_price_usd": int | None, # 39 | 99 | 299
      }
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    sb = get_client()
    res = (
        sb.table("merchants")
        .select(
            "grandfathered, subscription_status, trial_ends_at, "
            "next_billing_at, subscription_price_id, stripe_subscription_id, "
            "grace_period_starts_at, grace_period_ends_at"
        )
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return {"has_merchant": False}
    row = res.data[0]

    price_id = row.get("subscription_price_id")
    label_price = _PRICE_LABEL_FROM_ENV.get(price_id) if price_id else None
    plan_label = label_price[0] if label_price else None
    plan_price = label_price[1] if label_price else None

    trial_ends_at = row.get("trial_ends_at")
    grace_ends_at = row.get("grace_period_ends_at")
    status = row.get("subscription_status")
    # "Suspended" is an internal-only label. We never surface it to users —
    # the dashboard banner says "Your shop is paused. Update your payment
    # method to keep selling." The status value here is for the frontend
    # to gate Go Live + new orders; copy is decided in the React layer.
    is_suspended = status == "suspended"
    is_past_due = status == "past_due"

    return {
        "has_merchant": True,
        "grandfathered": bool(row.get("grandfathered")),
        "subscription_status": status,
        "trial_ends_at": trial_ends_at,
        "days_remaining": _days_until(trial_ends_at),
        "next_billing_at": row.get("next_billing_at"),
        "plan_label": plan_label,
        "plan_price_usd": plan_price,
        "has_subscription": bool(row.get("stripe_subscription_id")),
        "grace_period_starts_at": row.get("grace_period_starts_at"),
        "grace_period_ends_at": grace_ends_at,
        "grace_days_remaining": _days_until(grace_ends_at) if grace_ends_at else None,
        "is_past_due": is_past_due,
        "is_suspended": is_suspended,
    }


def is_merchant_suspended(privy_id: Optional[str]) -> bool:
    """Helper used by Go Live + new-order endpoints to gate access when
    the merchant's plan is suspended after a failed-payment grace period.

    Returns True only when:
      - a merchants row exists for this privy_id, AND
      - subscription_status == 'suspended'

    Grandfathered merchants are never suspended (they have no
    Stripe Subscription and never enter the grace flow). Missing-merchant
    callers return False so anonymous flows + non-merchant users are not
    blocked. Never raises.
    """
    if not privy_id:
        return False
    try:
        sb = get_client()
        res = (
            sb.table("merchants")
            .select("subscription_status, grandfathered")
            .eq("owner_privy_id", privy_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return False
        row = res.data[0]
        if row.get("grandfathered"):
            return False
        return row.get("subscription_status") == "suspended"
    except Exception as exc:
        # Fail open. A DB blip during suspension check should not lock
        # merchants out of their own dashboard.
        print(f"[is_merchant_suspended] check failed: {exc!r}")
        return False


@router.post("/cancel-trial")
async def cancel_trial(current_user: dict = Depends(get_current_user)):
    """
    Cancel the merchant's Stripe Subscription immediately. Called from a
    "Cancel before billing" CTA on the dashboard during the trial window.

    Idempotent: if there's no subscription on the merchants row, returns
    {cancelled: False, reason: "no_subscription"}.
    """
    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    sb = get_client()
    res = (
        sb.table("merchants")
        .select("id, stripe_subscription_id, grandfathered")
        .eq("owner_privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="merchant_not_found")
    row = res.data[0]
    if row.get("grandfathered"):
        return {"cancelled": False, "reason": "grandfathered"}
    sub_id = row.get("stripe_subscription_id")
    if not sub_id:
        return {"cancelled": False, "reason": "no_subscription"}

    if not cancel_subscription(sub_id):
        raise HTTPException(status_code=502, detail="stripe_cancel_failed")

    # Reflect immediately so the dashboard doesn't have to wait for the
    # customer.subscription.deleted webhook.
    try:
        sb.table("merchants").update({
            "subscription_status": "cancelled",
        }).eq("id", row["id"]).execute()
    except Exception as exc:
        print(f"[merchant/cancel-trial] write-through failed: {exc!r}")

    return {"cancelled": True}


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
        "details_submitted": bool,
        "requirements_currently_due": [str, ...],
        "requirements_eventually_due": [str, ...],
        "disabled_reason": str | null,
        "stripe_connect_id": str | null,
      }

    "verified" requires: charges_enabled AND payouts_enabled AND
    details_submitted AND no currently_due AND no disabled_reason.
    Anything less keeps checkout and go-live gates closed.
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
            "details_submitted": False,
            "requirements_currently_due": [],
            "requirements_eventually_due": [],
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
    details_submitted = bool(getattr(account, "details_submitted", False))
    requirements = getattr(account, "requirements", None)
    currently_due: list[str] = []
    eventually_due: list[str] = []
    disabled_reason: Optional[str] = None
    if requirements is not None:
        currently_due = list(getattr(requirements, "currently_due", []) or [])
        eventually_due = list(getattr(requirements, "eventually_due", []) or [])
        disabled_reason = getattr(requirements, "disabled_reason", None) or None

    # "verified" requires the full set of live-payment guarantees:
    # charges enabled, payouts enabled, details submitted, no
    # outstanding requirements, no Stripe-imposed restriction. Anything
    # short of that lands in pending_verification or restricted so the
    # checkout/go-live gates stay closed.
    if disabled_reason:
        new_status = "restricted"
    elif charges_enabled and payouts_enabled and details_submitted and not currently_due:
        new_status = "verified"
    else:
        new_status = "pending_verification"

    print(
        f"[merchant] stripe-connect/status: acct={connect_id} "
        f"charges_enabled={charges_enabled} payouts_enabled={payouts_enabled} "
        f"details_submitted={details_submitted} "
        f"currently_due={currently_due} eventually_due={eventually_due} "
        f"disabled_reason={disabled_reason!r} → status={new_status}"
    )

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
        "details_submitted": details_submitted,
        "requirements_currently_due": currently_due,
        "requirements_eventually_due": eventually_due,
        "disabled_reason": disabled_reason,
        "stripe_connect_id": connect_id,
    }


async def _log_callback_arrival(request: Request) -> None:
    """
    Pre-auth arrival log for /stripe-connect/callback. Runs BEFORE
    Depends(get_current_user) because it's declared first in the
    path operation signature. This is the single log we trust to
    prove the request reached the backend — independent of whether
    the Privy bearer is valid, HMAC state verifies, or Stripe
    credentials are correct.
    """
    print(
        f"[stripe-connect/callback] HIT: "
        f"client={request.client.host if request.client else 'unknown'} "
        f"query_keys={list(request.query_params.keys())} "
        f"has_auth_header={bool(request.headers.get('authorization'))}"
    )
    return None


@router.get("/stripe-connect/callback")
async def stripe_connect_callback(
    request: Request,
    code: str,
    state: str,
    _arrival: None = Depends(_log_callback_arrival),
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
    # Post-auth arrival log. This line prints AFTER Depends(get_current_user)
    # has successfully resolved — so if we see it, we know the request
    # reached Railway AND the Privy bearer was accepted. If we do NOT see
    # it but the request hit the server, the uvicorn access log will show
    # the 401 and we can stop looking at HMAC / Stripe / everything else.
    authed_privy_id = current_user.get("sub", "")
    print(
        f"[stripe-connect/callback] AUTHED: "
        f"privy_id=...{authed_privy_id[-6:] if authed_privy_id else 'none'} "
        f"client={request.client.host if request.client else 'unknown'} "
        f"has_code={bool(code)} has_state={bool(state)} "
        f"code_prefix={code[:6] if code else 'empty'}... "
        f"state_prefix={state[:10] if state else 'empty'}..."
    )

    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")

    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    # Gate 1: HMAC state token must be valid and bound to this user.
    # Raises 403 with a stable code on any failure mode. Wrap here so
    # the stable code lands in Railway logs — otherwise the HMAC failure
    # is invisible server-side (only the 403 JSON body the frontend sees).
    try:
        _verify_oauth_state(state, privy_id)
    except HTTPException as e:
        print(
            f"[stripe-connect/callback] HMAC state verification FAILED: "
            f"detail={e.detail!r} status={e.status_code}"
        )
        raise

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
