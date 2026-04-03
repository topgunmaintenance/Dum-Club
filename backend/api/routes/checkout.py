"""
Checkout — Stripe payment intents, webhook, and order queries.
"""
import os
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse, urlencode, parse_qs

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user, require_admin
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
    use_dum_discount: bool = False


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
    original_price = float(offer["price_usd"])
    base_price = original_price
    token_discount_applied = False

    # ── DUM Points discount: verify balance, deduct, reduce price ──
    # SUBSIDY MODEL: customer pays discounted price, business gets paid on original price
    if body.use_dum_discount and privy_id:
        try:
            dum_res = supabase.table("users").select("dum_balance").eq("privy_id", privy_id).limit(1).execute()
            dum_bal = dum_res.data[0].get("dum_balance", 0) if dum_res.data else 0
            if dum_bal >= 10:
                # Deduct 10 DUM Points
                supabase.table("users").update(
                    {"dum_balance": dum_bal - 10}
                ).eq("privy_id", privy_id).execute()
                # Credit business
                proj_id = offer.get("project_id")
                if proj_id:
                    try:
                        pr = supabase.table("projects").select("dum_received").eq("id", proj_id).limit(1).execute()
                        cur_recv = pr.data[0].get("dum_received", 0) if pr.data else 0
                        supabase.table("projects").update({"dum_received": cur_recv + 10}).eq("id", proj_id).execute()
                    except Exception:
                        pass
                # Apply 10% discount to what customer pays
                base_price = round(original_price * 0.9, 2)
                token_discount_applied = True
                print(f"[checkout] DUM discount applied: 10% off, customer pays=${base_price}, seller based on=${original_price}, buyer={privy_id}")
            else:
                print(f"[checkout] DUM discount rejected: balance={dum_bal} < 10, buyer={privy_id}")
        except Exception as exc:
            print(f"[checkout] DUM discount check failed (proceeding without discount): {exc!r}")

    final_price = base_price

    # Seller payout based on ORIGINAL price (platform subsidizes DUM discount)
    seller_payout_base = original_price if token_discount_applied else final_price
    platform_fee = round(seller_payout_base * PLATFORM_FEE_RATE, 2)
    seller_receives = round(seller_payout_base - platform_fee, 2)
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

    def _append_query_param(url: str, key: str, value: str) -> str:
        """Safely append a query parameter to a URL, replacing if already present."""
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        params[key] = [value]
        new_query = urlencode(params, doseq=True)
        return urlunparse(parsed._replace(query=new_query))

    print(f"[checkout] Creating Stripe session: offer={offer['id']}, amount_cents={amount_cents}, buyer={buyer_user_id}")

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
            success_url=_append_query_param(success_url, "checkout", "success"),
            cancel_url=_append_query_param(cancel_url, "checkout", "cancelled"),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")

    # 6. Insert order record
    print(f"[checkout] Session created: id={session.id}, pi={session.payment_intent}")

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

    print(f"[checkout] Inserting order: session_id={order_insert['stripe_session_id']}, pi={order_insert['stripe_payment_intent_id']}, status={order_insert['status']}")
    order_res = supabase.table("orders").insert(order_insert).execute()
    if not order_res.data:
        print("[checkout] ERROR: order insert returned no data")
        raise HTTPException(status_code=500, detail="Failed to create order record")

    order = order_res.data[0]
    print(f"[checkout] Order created: id={order['id']}")

    # Backfill order_id into Stripe session metadata for webhook reliability
    try:
        s.checkout.Session.modify(session.id, metadata={
            "offer_id": offer["id"],
            "buyer_user_id": buyer_user_id,
            "seller_user_id": seller_user_id,
            "project_id": project_id,
            "order_id": order["id"],
        })
        print(f"[checkout] Session metadata updated with order_id={order['id']}")
    except Exception as meta_err:
        print(f"[checkout] Warning: could not update session metadata: {meta_err}")

    # Also set metadata on the Payment Intent so payment_intent.succeeded
    # webhooks can find the order without an extra Stripe API call
    if session.payment_intent:
        try:
            s.PaymentIntent.modify(session.payment_intent, metadata={
                "offer_id": offer["id"],
                "buyer_user_id": buyer_user_id,
                "seller_user_id": seller_user_id,
                "project_id": project_id,
                "order_id": order["id"],
            })
            print(f"[checkout] Payment Intent metadata updated: PI={session.payment_intent}")
        except Exception as pi_meta_err:
            print(f"[checkout] Warning: could not update PI metadata: {pi_meta_err}")

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
    print(f"[webhook] ========== WEBHOOK RECEIVED ==========")

    if not _STRIPE_WEBHOOK_SECRET:
        print("[webhook] ERROR: STRIPE_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    print(f"[webhook] Payload size: {len(payload)} bytes, sig present: {bool(sig_header)}")

    s = _get_stripe()
    try:
        event = s.Webhook.construct_event(
            payload, sig_header, _STRIPE_WEBHOOK_SECRET
        )
        print(f"[webhook] ✓ Signature verified. Event: {event['type']} id={event['id']}")
    except Exception as e:
        print(f"[webhook] ✗ Signature FAILED: {type(e).__name__}: {e}")
        raise HTTPException(status_code=400, detail=f"Webhook signature failed: {type(e).__name__}")

    supabase = get_client()

    def _find_order(session_id: str, pi_id: str, metadata: dict) -> dict | None:
        """Try multiple strategies to find the matching order."""

        # Strategy 1: stripe_session_id (most reliable if column exists)
        if session_id:
            print(f"[webhook] Lookup strategy 1: stripe_session_id={session_id}")
            res = supabase.table("orders").select("id, offer_id, status").eq("stripe_session_id", session_id).limit(1).execute()
            if res.data:
                print(f"[webhook] ✓ Found by stripe_session_id: order={res.data[0]['id']}")
                return res.data[0]
            print(f"[webhook] ✗ Not found by stripe_session_id")

        # Strategy 2: stripe_payment_intent_id
        if pi_id:
            print(f"[webhook] Lookup strategy 2: stripe_payment_intent_id={pi_id}")
            res = supabase.table("orders").select("id, offer_id, status").eq("stripe_payment_intent_id", pi_id).limit(1).execute()
            if res.data:
                print(f"[webhook] ✓ Found by stripe_payment_intent_id: order={res.data[0]['id']}")
                return res.data[0]
            print(f"[webhook] ✗ Not found by stripe_payment_intent_id")

        # Strategy 3: order_id from metadata (set after order creation)
        order_id = metadata.get("order_id")
        if order_id:
            print(f"[webhook] Lookup strategy 3: order_id={order_id}")
            res = supabase.table("orders").select("id, offer_id, status").eq("id", order_id).limit(1).execute()
            if res.data:
                print(f"[webhook] ✓ Found by order_id: order={res.data[0]['id']}")
                return res.data[0]
            print(f"[webhook] ✗ Not found by order_id")

        # Strategy 4: metadata (offer_id + buyer_user_id + most recent pending)
        offer_id = metadata.get("offer_id")
        buyer_id = metadata.get("buyer_user_id")
        if offer_id and buyer_id:
            print(f"[webhook] Lookup strategy 3: metadata offer_id={offer_id}, buyer={buyer_id}")
            res = (
                supabase.table("orders")
                .select("id, offer_id, status")
                .eq("offer_id", offer_id)
                .eq("buyer_user_id", buyer_id)
                .in_("status", ["pending_payment", "pending"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if res.data:
                print(f"[webhook] ✓ Found by metadata: order={res.data[0]['id']}")
                return res.data[0]
            print(f"[webhook] ✗ Not found by metadata")

        print(f"[webhook] ✗✗ ALL LOOKUP STRATEGIES FAILED")
        return None

    def _process_paid(order: dict, session_id: str, pi_id: str, source: str):
        """Update order to paid, decrement inventory, send emails."""
        if order["status"] not in ("pending_payment", "pending"):
            print(f"[webhook] Order {order['id']} already {order['status']}, skipping")
            return

        # Update order to paid + backfill IDs
        update_fields: dict = {"status": "paid", "updated_at": _now_iso()}
        if session_id:
            update_fields["stripe_session_id"] = session_id
        if pi_id:
            update_fields["stripe_payment_intent_id"] = pi_id

        update_res = supabase.table("orders").update(update_fields).eq("id", order["id"]).execute()
        rows = len(update_res.data or [])
        print(f"[webhook] ✓ Order {order['id']} → paid (rows={rows}, source={source})")

        # Decrement inventory
        offer_id = order.get("offer_id")
        if offer_id:
            offer_res = supabase.table("offers").select("id, quantity_sold, quantity_available, unlimited_inventory").eq("id", offer_id).limit(1).execute()
            if offer_res.data:
                o = offer_res.data[0]
                is_unlimited = o.get("unlimited_inventory")
                current_sold = o.get("quantity_sold") or 0
                current_available = o.get("quantity_available")
                print(f"[webhook] Inventory check: offer={offer_id}, unlimited={is_unlimited}, sold={current_sold}, available={current_available}")

                # Always increment quantity_sold (tracks total sales regardless of unlimited flag)
                new_sold = current_sold + 1
                supabase.table("offers").update({"quantity_sold": new_sold}).eq("id", offer_id).execute()
                print(f"[webhook] Inventory updated: offer={offer_id}, quantity_sold {current_sold} → {new_sold}")
            else:
                print(f"[webhook] WARNING: offer {offer_id} not found for inventory update")

        # Send emails (non-blocking)
        try:
            full_order = supabase.table("orders").select("*, offers(title, price_usd, project_id)").eq("id", order["id"]).single().execute()
            od = full_order.data or {}
            offer_data = od.get("offers") or {}
            offer_title = offer_data.get("title", "Order")
            amount = float(od.get("amount_paid_usd", 0))
            seller_receives_val = float(od.get("seller_receives_usd", 0))
            proj_id = od.get("project_id", "")

            proj_name = ""
            if proj_id:
                proj_res = supabase.table("projects").select("title, name").eq("id", proj_id).limit(1).execute()
                if proj_res.data:
                    proj_name = proj_res.data[0].get("title") or proj_res.data[0].get("name") or ""

            buyer_email = od.get("buyer_email")
            if not buyer_email:
                buyer_uid = od.get("buyer_user_id")
                if buyer_uid:
                    u_res = supabase.table("users").select("email").eq("privy_id", buyer_uid).limit(1).execute()
                    if u_res.data:
                        buyer_email = u_res.data[0].get("email")

            send_buyer_payment_confirmed(buyer_email or "", offer_title, amount, proj_name)
            print(f"[webhook] Buyer email: {'sent' if buyer_email else 'skipped (no email)'}")

            # Award +2 DUM Points to buyer for purchase
            buyer_uid = od.get("buyer_user_id")
            if buyer_uid:
                try:
                    dum_res = supabase.table("users").select("dum_balance").eq("privy_id", buyer_uid).limit(1).execute()
                    if dum_res.data:
                        cur_dum = dum_res.data[0].get("dum_balance", 50)
                        supabase.table("users").update({"dum_balance": cur_dum + 2}).eq("privy_id", buyer_uid).execute()
                        print(f"[webhook] awarded 2 DUM to buyer {buyer_uid} → {cur_dum + 2}")
                except Exception as dum_err:
                    print(f"[webhook] DUM award failed (non-fatal): {dum_err}")

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
            send_seller_new_order(seller_email, offer_title, amount, seller_receives_val, proj_id)
            print(f"[webhook] Seller email: {'sent' if seller_email else 'skipped (no email)'}")
        except Exception as email_err:
            print(f"[webhook] Email error (non-blocking): {email_err}")

    # ── Event routing ────────────────────────────────────────

    if event["type"] == "checkout.session.completed":
        obj = event["data"]["object"]
        session_id = obj["id"]
        pi_id = obj.get("payment_intent")
        metadata = obj.get("metadata", {})
        payment_status = obj.get("payment_status", "unknown")
        print(f"[webhook] checkout.session.completed: session={session_id}, PI={pi_id}, payment_status={payment_status}")
        print(f"[webhook] Metadata: {metadata}")

        if payment_status != "paid":
            print(f"[webhook] Payment not confirmed yet (status={payment_status}), skipping")
            return JSONResponse(content={"received": True}, status_code=200)

        order = _find_order(session_id, pi_id, metadata)
        if order:
            _process_paid(order, session_id, pi_id, "checkout.session.completed")
        else:
            print(f"[webhook] CRITICAL: Could not find order for session={session_id}")

    elif event["type"] == "payment_intent.succeeded":
        obj = event["data"]["object"]
        pi_id = obj["id"]
        metadata = obj.get("metadata", {})
        print(f"[webhook] payment_intent.succeeded: PI={pi_id}")
        print(f"[webhook] PI metadata: {metadata}")

        order = _find_order("", pi_id, metadata)

        # If PI lookup fails, resolve the Checkout Session from Stripe and retry
        # with the session_id. This handles the common case where the order row has
        # stripe_session_id but stripe_payment_intent_id is NULL (Stripe doesn't
        # assign the PI until the customer pays, after session creation).
        if not order:
            print(f"[webhook] PI lookup failed — attempting to resolve Checkout Session from Stripe")
            try:
                sessions = s.checkout.Session.list(payment_intent=pi_id, limit=1)
                if sessions.data:
                    resolved_session = sessions.data[0]
                    resolved_session_id = resolved_session["id"]
                    resolved_metadata = resolved_session.get("metadata", {})
                    print(f"[webhook] Resolved session_id={resolved_session_id} from PI={pi_id}")
                    print(f"[webhook] Session metadata: {resolved_metadata}")
                    order = _find_order(resolved_session_id, pi_id, resolved_metadata)
                else:
                    print(f"[webhook] No Checkout Session found for PI={pi_id}")
            except Exception as resolve_err:
                print(f"[webhook] Error resolving session from PI: {type(resolve_err).__name__}: {resolve_err}")

        if order:
            # Backfill the PI ID so future lookups work directly
            if pi_id:
                try:
                    supabase.table("orders").update({"stripe_payment_intent_id": pi_id}).eq("id", order["id"]).execute()
                    print(f"[webhook] Backfilled stripe_payment_intent_id={pi_id} on order {order['id']}")
                except Exception:
                    pass
            _process_paid(order, "", pi_id, "payment_intent.succeeded")
        else:
            print(f"[webhook] No order found for PI={pi_id} (may already be processed by session event)")

    else:
        print(f"[webhook] Unhandled event: {event['type']}")

    print(f"[webhook] ========== WEBHOOK DONE ==========")
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


# ── Admin: Recover stuck orders ──────────────────────────────

@router.post("/orders/recover-pending")
async def recover_pending_orders(_admin=Depends(require_admin)):
    """
    Admin-only: find orders stuck in pending_payment, check Stripe for actual
    payment status, and process any that were actually paid.
    """
    print("[recover] ========== RECOVERING PENDING ORDERS ==========")
    supabase = get_client()
    s = _get_stripe()

    # Find all stuck orders
    pending_res = (
        supabase.table("orders")
        .select("id, offer_id, stripe_session_id, stripe_payment_intent_id, status, created_at")
        .eq("status", "pending_payment")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    stuck_orders = pending_res.data or []
    print(f"[recover] Found {len(stuck_orders)} pending_payment orders")

    results = []
    for order in stuck_orders:
        order_id = order["id"]
        session_id = order.get("stripe_session_id")
        pi_id = order.get("stripe_payment_intent_id")

        try:
            # Check Stripe for actual payment status
            paid = False
            actual_pi_id = pi_id

            if session_id:
                session = s.checkout.Session.retrieve(session_id)
                print(f"[recover] Order {order_id}: session={session_id}, payment_status={session.payment_status}")
                if session.payment_status == "paid":
                    paid = True
                    actual_pi_id = actual_pi_id or session.payment_intent

            if not paid and actual_pi_id:
                pi = s.PaymentIntent.retrieve(actual_pi_id)
                print(f"[recover] Order {order_id}: PI={actual_pi_id}, status={pi.status}")
                if pi.status == "succeeded":
                    paid = True

            if paid:
                print(f"[recover] Order {order_id} was PAID in Stripe — processing now")
                # Reuse the existing _process_paid logic inline
                update_fields = {"status": "paid", "updated_at": _now_iso()}
                if actual_pi_id:
                    update_fields["stripe_payment_intent_id"] = actual_pi_id
                supabase.table("orders").update(update_fields).eq("id", order_id).execute()

                # Increment quantity_sold
                offer_id = order.get("offer_id")
                if offer_id:
                    offer_res = supabase.table("offers").select("id, quantity_sold").eq("id", offer_id).limit(1).execute()
                    if offer_res.data:
                        current_sold = offer_res.data[0].get("quantity_sold") or 0
                        supabase.table("offers").update({"quantity_sold": current_sold + 1}).eq("id", offer_id).execute()
                        print(f"[recover] Offer {offer_id}: quantity_sold {current_sold} → {current_sold + 1}")

                results.append({"order_id": order_id, "action": "recovered", "stripe_status": "paid"})
            else:
                print(f"[recover] Order {order_id}: NOT paid in Stripe, skipping")
                results.append({"order_id": order_id, "action": "skipped", "stripe_status": "unpaid"})

        except Exception as e:
            print(f"[recover] Error checking order {order_id}: {type(e).__name__}: {e}")
            results.append({"order_id": order_id, "action": "error", "error": str(e)})

    recovered_count = sum(1 for r in results if r["action"] == "recovered")
    print(f"[recover] Done: {recovered_count}/{len(stuck_orders)} orders recovered")
    print(f"[recover] ========== RECOVERY DONE ==========")

    return {
        "total_pending": len(stuck_orders),
        "recovered": recovered_count,
        "results": results,
    }
