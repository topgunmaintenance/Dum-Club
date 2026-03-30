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
from services.email import send_buyer_payment_confirmed, send_seller_new_order, send_buyer_fulfilled

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
        except ImportError:
            raise HTTPException(status_code=503, detail="Stripe SDK not installed — add stripe to requirements-prod.txt")
        if not _STRIPE_SECRET:
            raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY environment variable is not set")
        stripe.api_key = _STRIPE_SECRET
        _stripe = stripe
    return _stripe

PLATFORM_FEE_RATE = 0.07  # 7%


# ── Models ────────────────────────────────────────────────────

class PaymentIntentRequest(BaseModel):
    offer_id: str
    buyer_email: Optional[str] = None
    notes: Optional[str] = None
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


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

    # 4a. Check inventory
    if not offer.get("unlimited_inventory", True):
        available = (offer.get("quantity_available") or 0) - (offer.get("quantity_sold") or 0)
        if available <= 0:
            raise HTTPException(status_code=400, detail="This offer is sold out")

    # 5. Create Stripe Checkout Session
    s = _get_stripe()
    success_url = body.success_url or "https://dum-club.vercel.app/dashboard"
    cancel_url = body.cancel_url or success_url

    try:
        session = s.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": amount_cents,
                    "product_data": {
                        "name": offer["title"],
                        "description": (offer.get("description") or "")[:500] or None,
                    },
                },
                "quantity": 1,
            }],
            metadata={
                "offer_id": offer["id"],
                "buyer_user_id": buyer_user_id,
                "seller_user_id": seller_user_id,
                "project_id": project_id,
            },
            success_url=success_url + "?checkout=success",
            cancel_url=cancel_url + "?checkout=cancelled",
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
        "stripe_payment_intent_id": session.payment_intent,
        "stripe_session_id": session.id,
        "status": "pending_payment",
        "buyer_email": body.buyer_email,
        "notes": body.notes,
        "token_discount_applied": token_discount_applied,
    }

    order_res = supabase.table("orders").insert(order_insert).execute()
    if not order_res.data:
        raise HTTPException(status_code=500, detail="Failed to create order record")

    order = order_res.data[0]

    return {
        "checkout_url": session.url,
        "session_id": session.id,
        "order_id": order["id"],
        "final_price": final_price,
        "platform_fee": platform_fee,
        "seller_receives": seller_receives,
    }


# ── Stripe Webhook ────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(request: Request):
    print(f"[webhook] Received webhook request")

    if not _STRIPE_WEBHOOK_SECRET:
        print("[webhook] ERROR: STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    print(f"[webhook] Signature header present: {bool(sig_header)}")

    s = _get_stripe()
    try:
        event = s.Webhook.construct_event(
            payload, sig_header, _STRIPE_WEBHOOK_SECRET
        )
        print(f"[webhook] Signature verified. Event type: {event['type']}")
    except Exception as e:
        print(f"[webhook] Signature verification FAILED: {type(e).__name__}: {e}")
        raise HTTPException(status_code=400, detail=f"Webhook signature failed: {type(e).__name__}")

    supabase = get_client()

    def _mark_paid(lookup_field: str, lookup_value: str, source: str):
        """Idempotent: only update if current status is pending_payment or pending."""
        print(f"[webhook] Looking up order: {lookup_field}={lookup_value}")
        order_res = (
            supabase.table("orders")
            .select("id, offer_id, status")
            .eq(lookup_field, lookup_value)
            .limit(1)
            .execute()
        )
        if not order_res.data:
            print(f"[webhook] No order found: {lookup_field}={lookup_value}")
            return False
        order = order_res.data[0]
        print(f"[webhook] Found order {order['id']}, current status: {order['status']}")
        if order["status"] not in ("pending_payment", "pending"):
            print(f"[webhook] Order {order['id']} already {order['status']}, skipping ({source})")
            return True  # Already processed

        # Update order to paid
        update_res = supabase.table("orders").update({
            "status": "paid",
            "updated_at": _now_iso(),
        }).eq("id", order["id"]).execute()
        print(f"[webhook] Order {order['id']} updated to paid. Rows: {len(update_res.data or [])}")

        # Decrement inventory on the offer
        offer_id = order.get("offer_id")
        if offer_id:
            offer_res = (
                supabase.table("offers")
                .select("id, quantity_sold, unlimited_inventory")
                .eq("id", offer_id)
                .limit(1)
                .execute()
            )
            if offer_res.data:
                o = offer_res.data[0]
                if not o.get("unlimited_inventory", True):
                    new_sold = (o.get("quantity_sold") or 0) + 1
                    supabase.table("offers").update({
                        "quantity_sold": new_sold,
                    }).eq("id", offer_id).execute()
                    print(f"[webhook] Inventory decremented for offer {offer_id}: sold={new_sold}")

        print(f"[webhook] Order {order['id']} → paid ({source})")

        # Send email notifications (non-blocking)
        try:
            full_order = supabase.table("orders").select("*, offers(title, price_usd, project_id)").eq("id", order["id"]).single().execute()
            od = full_order.data or {}
            offer_data = od.get("offers") or {}
            offer_title = offer_data.get("title", "Order")
            amount = float(od.get("amount_paid_usd", 0))
            seller_receives = float(od.get("seller_receives_usd", 0))
            project_id = od.get("project_id", "")

            # Get project name for buyer email
            proj_name = ""
            if project_id:
                proj_res = supabase.table("projects").select("title, name").eq("id", project_id).limit(1).execute()
                if proj_res.data:
                    proj_name = proj_res.data[0].get("title") or proj_res.data[0].get("name") or ""

            # Buyer email
            buyer_email = od.get("buyer_email")
            if not buyer_email:
                # Try to resolve from buyer_user_id (privy_id) → users → email
                buyer_uid = od.get("buyer_user_id")
                if buyer_uid:
                    u_res = supabase.table("users").select("email").eq("privy_id", buyer_uid).limit(1).execute()
                    if u_res.data:
                        buyer_email = u_res.data[0].get("email")

            send_buyer_payment_confirmed(buyer_email or "", offer_title, amount, proj_name)

            # Seller email — resolve from seller_user_id (profiles.id → wallet → users.email)
            seller_uid = od.get("seller_user_id")
            seller_email = ""
            if seller_uid:
                prof_res = supabase.table("profiles").select("wallet_address").eq("id", seller_uid).limit(1).execute()
                if prof_res.data:
                    wallet = prof_res.data[0].get("wallet_address")
                    if wallet:
                        u_res = supabase.table("users").select("email").eq("wallet_address", wallet).limit(1).execute()
                        if u_res.data:
                            seller_email = u_res.data[0].get("email") or ""
            send_seller_new_order(seller_email, offer_title, amount, seller_receives, project_id)
        except Exception as email_err:
            print(f"[webhook] Email notification error (non-blocking): {email_err}")

        return True

    if event["type"] == "payment_intent.succeeded":
        pi_id = event["data"]["object"]["id"]
        print(f"[webhook] payment_intent.succeeded: PI={pi_id}")
        _mark_paid("stripe_payment_intent_id", pi_id, "payment_intent.succeeded")

    elif event["type"] == "checkout.session.completed":
        session_obj = event["data"]["object"]
        session_id = session_obj["id"]
        pi_id = session_obj.get("payment_intent")
        print(f"[webhook] checkout.session.completed: session={session_id}, PI={pi_id}")

        # Try stripe_session_id FIRST (always stored at creation)
        found = _mark_paid("stripe_session_id", session_id, "checkout.session.completed/session")

        # Fallback: try PI if session lookup failed
        if not found and pi_id:
            print(f"[webhook] Session lookup failed, trying PI lookup: {pi_id}")
            _mark_paid("stripe_payment_intent_id", pi_id, "checkout.session.completed/pi_fallback")

    else:
        print(f"[webhook] Unhandled event type: {event['type']}")

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


@router.patch("/orders/{order_id}/status")
async def update_order_status(
    order_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Owner marks an order as delivered."""
    body = await request.json()
    new_status = body.get("status")
    if new_status not in ("fulfilled", "delivered"):
        raise HTTPException(status_code=400, detail="Invalid status. Allowed: fulfilled, delivered")

    supabase = get_client()
    privy_id = current_user.get("sub")

    order_res = (
        supabase.table("orders")
        .select("id, project_id, status")
        .eq("id", order_id)
        .limit(1)
        .execute()
    )
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    order = order_res.data[0]
    if order["status"] not in ("paid", "fulfilled"):
        raise HTTPException(status_code=400, detail="Only paid or fulfilled orders can be updated")

    project_res = (
        supabase.table("projects")
        .select("owner_id")
        .eq("id", order["project_id"])
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    resolved = _resolve_privy_to_owner(supabase, privy_id)
    if resolved != project_res.data[0].get("owner_id"):
        raise HTTPException(status_code=403, detail="Not the project owner")

    supabase.table("orders").update({
        "status": new_status,
        "updated_at": _now_iso(),
    }).eq("id", order_id).execute()

    # Send fulfillment email to buyer (non-blocking)
    if new_status in ("fulfilled", "delivered"):
        try:
            full_order = supabase.table("orders").select("*, offers(title)").eq("id", order_id).single().execute()
            od = full_order.data or {}
            offer_title = (od.get("offers") or {}).get("title", "Order")
            buyer_email = od.get("buyer_email")
            if not buyer_email:
                buyer_uid = od.get("buyer_user_id")
                if buyer_uid:
                    u_res = supabase.table("users").select("email").eq("privy_id", buyer_uid).limit(1).execute()
                    if u_res.data:
                        buyer_email = u_res.data[0].get("email")
            send_buyer_fulfilled(buyer_email or "", offer_title)
        except Exception as email_err:
            print(f"[fulfillment] Email error (non-blocking): {email_err}")

    return {"status": new_status, "order_id": order_id}
