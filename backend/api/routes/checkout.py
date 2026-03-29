"""
Checkout — Stripe payment intents, webhook, and order queries.
"""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user

router = APIRouter()

# ── Stripe config (lazy import — backend starts without stripe installed) ──

_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "")
_STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
_stripe = None


def _get_stripe():
    global _stripe
    if _stripe is None:
        try:
            import stripe
            stripe.api_key = _STRIPE_SECRET
            _stripe = stripe
        except ImportError:
            raise HTTPException(status_code=503, detail="Stripe SDK not installed")
    return _stripe

PLATFORM_FEE_RATE = 0.07  # 7%


# ── Models ────────────────────────────────────────────────────

class PaymentIntentRequest(BaseModel):
    offer_id: str
    buyer_email: Optional[str] = None
    notes: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _resolve_privy_to_owner(supabase, privy_id: str) -> Optional[str]:
    """Resolve a Privy ID to profiles.id."""
    user_res = (
        supabase.table("users")
        .select("wallet_address")
        .eq("privy_id", privy_id)
        .limit(1)
        .execute()
    )
    if not user_res.data:
        return None
    wallet = user_res.data[0].get("wallet_address")
    if not wallet:
        return None
    profile_res = (
        supabase.table("profiles")
        .select("id")
        .eq("wallet_address", wallet)
        .limit(1)
        .execute()
    )
    if not profile_res.data:
        return None
    return profile_res.data[0].get("id")


# ── Payment Intent ────────────────────────────────────────────

@router.post("/create-payment-intent")
async def create_payment_intent(
    body: PaymentIntentRequest,
    current_user: dict = Depends(get_current_user),
):
    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    supabase = get_client()
    privy_id = current_user.get("sub")

    # 1. Fetch offer
    offer_res = (
        supabase.table("offers")
        .select("*")
        .eq("id", body.offer_id)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    if not offer_res.data:
        raise HTTPException(status_code=404, detail="Offer not found or inactive")
    offer = offer_res.data[0]

    # 2. Determine seller from project owner
    project_id = offer["project_id"]
    project_res = (
        supabase.table("projects")
        .select("owner_id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    seller_user_id = project_res.data[0].get("owner_id") or ""

    # 3. Calculate price
    base_price = float(offer["price_usd"])
    token_discount_applied = False

    # TODO: Phase 10 — check actual token balance for discount eligibility
    # For now, discount is not applied automatically
    final_price = base_price

    platform_fee = round(final_price * PLATFORM_FEE_RATE, 2)
    seller_receives = round(final_price - platform_fee, 2)
    amount_cents = int(round(final_price * 100))

    if amount_cents < 50:
        raise HTTPException(status_code=400, detail="Minimum charge is $0.50")

    # 4. Resolve buyer identity
    buyer_user_id = privy_id

    # 5. Create Stripe PaymentIntent
    s = _get_stripe()
    try:
        intent = s.PaymentIntent.create(
            amount=amount_cents,
            currency="usd",
            metadata={
                "offer_id": offer["id"],
                "buyer_user_id": buyer_user_id,
                "seller_user_id": seller_user_id,
                "project_id": project_id,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")

    # 6. Insert order record
    order_insert = {
        "offer_id": offer["id"],
        "project_id": project_id,
        "buyer_user_id": buyer_user_id,
        "seller_user_id": seller_user_id,
        "amount_paid_usd": final_price,
        "platform_fee_usd": platform_fee,
        "seller_receives_usd": seller_receives,
        "stripe_payment_intent_id": intent.id,
        "status": "pending",
        "buyer_email": body.buyer_email,
        "notes": body.notes,
        "token_discount_applied": token_discount_applied,
    }

    order_res = supabase.table("orders").insert(order_insert).execute()
    if not order_res.data:
        raise HTTPException(status_code=500, detail="Failed to create order record")

    order = order_res.data[0]

    return {
        "client_secret": intent.client_secret,
        "order_id": order["id"],
        "final_price": final_price,
        "platform_fee": platform_fee,
        "seller_receives": seller_receives,
        "stripe_payment_intent_id": intent.id,
    }


# ── Stripe Webhook ────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(request: Request):
    if not _STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    s = _get_stripe()
    try:
        event = s.Webhook.construct_event(
            payload, sig_header, _STRIPE_WEBHOOK_SECRET
        )
    except Exception as e:
        if "SignatureVerification" in type(e).__name__:
            raise HTTPException(status_code=400, detail="Invalid signature")
        raise HTTPException(status_code=400, detail=str(e))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    if event["type"] == "payment_intent.succeeded":
        pi = event["data"]["object"]
        pi_id = pi["id"]

        supabase = get_client()
        supabase.table("orders").update({
            "status": "paid",
            "updated_at": _now_iso(),
        }).eq("stripe_payment_intent_id", pi_id).execute()

        print(f"[checkout] Order paid: PI={pi_id}")

    return JSONResponse(content={"received": True}, status_code=200)


# ── Order Queries ─────────────────────────────────────────────

@router.get("/orders/buyer")
async def buyer_orders(current_user: dict = Depends(get_current_user)):
    supabase = get_client()
    privy_id = current_user.get("sub")

    res = (
        supabase.table("orders")
        .select("*, offers(title, offer_type, price_usd)")
        .eq("buyer_user_id", privy_id)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []


@router.get("/orders/seller/{project_id}")
async def seller_orders(
    project_id: str,
    current_user: dict = Depends(get_current_user),
):
    supabase = get_client()
    privy_id = current_user.get("sub")

    # Verify ownership
    project_res = (
        supabase.table("projects")
        .select("owner_id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    owner_id = project_res.data[0].get("owner_id")
    resolved = _resolve_privy_to_owner(supabase, privy_id)
    if resolved != owner_id:
        raise HTTPException(status_code=403, detail="Not the project owner")

    res = (
        supabase.table("orders")
        .select("*, offers(title, offer_type, price_usd)")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []
