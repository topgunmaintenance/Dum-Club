"""
Checkout — Stripe payment intents, webhook, and order queries.
"""
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse, urlunparse, urlencode, parse_qs

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user, require_admin
from services.email import send_buyer_payment_confirmed, send_seller_new_order, send_buyer_fulfilled
from api.routes.auction_ws import broadcast_sync

router = APIRouter()

# ── Stripe config (lazy import — backend starts without stripe installed) ──

# .strip() defensively — Railway env var editors and copy-paste flows
# attach trailing whitespace/newlines often enough that it's worth
# handling at read time. See merchant.py for the full justification.
_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "").strip()
_STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
_stripe = None


# ── Test-mode bypass for charges_enabled ─────────────────────────────
# Allows the full checkout flow to run against a Stripe Connect account
# that hasn't cleared identity review yet — useful for end-to-end
# testing while Stripe's verification queue is pending. Only active
# when one of two explicit opt-ins is set in the environment:
#
#   ENVIRONMENT=development      — general dev/staging toggle
#   STRIPE_TEST_MODE=true        — Stripe-specific override
#
# Default (both unset, or ENVIRONMENT set to anything other than
# "development") is the production behavior: 400
# merchant_stripe_not_verified when charges_enabled=False. Bypass is
# NEVER automatic — it must be enabled explicitly, is logged clearly
# on every use, and is removed the moment the env var is unset.
_ENVIRONMENT = os.getenv("ENVIRONMENT", "production").strip().lower()
_STRIPE_TEST_MODE = os.getenv("STRIPE_TEST_MODE", "").strip().lower() == "true"


def _checkout_verification_bypass_allowed() -> bool:
    """
    True when the checkout's merchant-verification guard should be
    bypassed. Requires an explicit opt-in; returns False in normal
    production configurations.
    """
    return _ENVIRONMENT == "development" or _STRIPE_TEST_MODE


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
    source: str = "normal"
    auction_id: Optional[str] = None
    override_price: Optional[float] = None


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


def _get_seller_stripe_connect_id(supabase, seller_user_id: str) -> Optional[str]:
    """
    Return the seller's Stripe Connect account id if they've completed
    OAuth (merchants.stripe_connect_id is set), else None. Joining on
    merchants.owner_privy_id — matches the column the OAuth callback
    writes in merchant.py:304.
    """
    if not seller_user_id:
        return None
    res = (
        supabase.table("merchants")
        .select("stripe_connect_id")
        .eq("owner_privy_id", seller_user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    return res.data[0].get("stripe_connect_id") or None


def _assert_merchant_can_receive(stripe_sdk, connect_id: str) -> None:
    """
    Refuse to create a checkout session unless Stripe's live account
    state says the merchant can actually accept charges. This is the
    guard that prevents the "connected but not verified yet" class of
    bug — OAuth completes in seconds but Stripe's identity review
    takes 24-48h, and until charges_enabled flips true on Stripe's
    side, any Session created here would fail at the customer-paying
    step (or worse, succeed and strand the funds).

    Raises HTTPException(400, ...) with a stable error code so the
    frontend can show the right message.
    """
    try:
        account = stripe_sdk.Account.retrieve(connect_id)
    except Exception as exc:
        print(f"[checkout] Stripe Account.retrieve failed for {connect_id}: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="stripe_account_retrieve_failed",
        )

    if not getattr(account, "charges_enabled", False):
        currently_due = []
        try:
            reqs = getattr(account, "requirements", None)
            if reqs is not None:
                currently_due = list(getattr(reqs, "currently_due", []) or [])
        except Exception:
            currently_due = []

        # Dev/test bypass: when ENVIRONMENT=development or
        # STRIPE_TEST_MODE=true, allow checkout to proceed against an
        # unverified Connect account so we can smoke-test the full
        # payment flow while Stripe's review is pending. Loud warning
        # log every time the bypass fires — it's never silent, and it
        # never activates without an explicit env opt-in.
        if _checkout_verification_bypass_allowed():
            print(
                f"[checkout] ⚠ BYPASS charges_enabled gate: merchant={connect_id} "
                f"ENVIRONMENT={_ENVIRONMENT!r} STRIPE_TEST_MODE={_STRIPE_TEST_MODE} "
                f"currently_due={currently_due}. "
                f"Bypass MUST NOT be enabled with live Stripe keys."
            )
            return

        print(
            f"[checkout] Merchant {connect_id} cannot accept charges: "
            f"currently_due={currently_due}"
        )
        raise HTTPException(
            status_code=400,
            detail={
                "code": "merchant_stripe_not_verified",
                "message": (
                    "Merchant's Stripe account is still being verified. "
                    "Try again in a few hours."
                ),
                "requirements_due": currently_due,
            },
        )


# ── Payment Intent ────────────────────────────────────────────

@router.post("/create-payment-intent")
async def create_payment_intent(
    body: PaymentIntentRequest,
    current_user: dict = Depends(get_current_user),
):
    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    print(f"[checkout] Request: offer_id={body.offer_id}, source={body.source}, auction_id={body.auction_id}, override_price={body.override_price}, use_dum_discount={body.use_dum_discount}")

    supabase = get_client()
    privy_id = current_user.get("sub")
    print(f"[checkout] Buyer: privy_id={privy_id}")

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

    # 2. Determine seller from project owner.
    #
    # The seller is identified by Privy DID across the rest of the pipeline:
    #   - metadata["seller_user_id"]                  → Stripe metadata
    #   - orders.seller_user_id (TEXT)                → downstream lookups
    #   - merchants.owner_privy_id                    → Stripe Connect id lookup
    #   - users.privy_id                              → seller-email lookup
    #
    # projects.privy_id holds the raw Privy DID — this is the field that
    # matches every downstream consumer. projects.owner_id is a profiles.id
    # UUID (see migration 005) that does NOT match any of the above; using
    # it silently broke the seller→merchant lookup because a UUID will
    # never equal a Privy DID string. Prefer privy_id; fall back to
    # owner_id only for legacy rows that predate migration 005.
    project_id = offer["project_id"]
    project_res = (
        supabase.table("projects")
        .select("owner_id, privy_id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    seller_user_id = (
        project_res.data[0].get("privy_id")
        or project_res.data[0].get("owner_id")
        or ""
    )

    # 3. Calculate price (auction override takes precedence)
    if body.override_price is not None and body.auction_id:
        original_price = body.override_price
    else:
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

    # Stripe minimum is $0.50 USD
    if amount_cents < 50:
        print(f"[checkout] Price below Stripe minimum: amount_cents={amount_cents}, price={final_price}, offer={body.offer_id}")
        raise HTTPException(status_code=400, detail=f"Price must be at least $0.50 for checkout. This offer is ${final_price:.2f}. Update the offer price in your dashboard.")

    # 4. Resolve buyer identity
    buyer_user_id = privy_id

    # 4a. Check inventory (only enforce if seller explicitly set a quantity limit)
    is_unlimited = offer.get("unlimited_inventory", True)
    qty_available = offer.get("quantity_available") or 0
    qty_sold = offer.get("quantity_sold") or 0

    if not is_unlimited and qty_available > 0:
        remaining = qty_available - qty_sold
        if remaining <= 0:
            print(f"[checkout] Sold out: offer={body.offer_id}, available={qty_available}, sold={qty_sold}")
            raise HTTPException(status_code=400, detail="This offer is sold out")
        print(f"[checkout] Inventory OK: {remaining} remaining (available={qty_available}, sold={qty_sold})")
    else:
        print(f"[checkout] Unlimited inventory or no limit set: unlimited={is_unlimited}, qty_available={qty_available}")

    # 5. Resolve buyer email for Stripe receipt
    buyer_email = body.buyer_email
    if not buyer_email and privy_id:
        try:
            user_res = supabase.table("users").select("email").eq("privy_id", privy_id).limit(1).execute()
            if user_res.data:
                buyer_email = user_res.data[0].get("email")
        except Exception:
            pass
    print(f"[checkout] Buyer email for receipt: {buyer_email or 'none — Stripe will collect'}")

    # 6. Create Stripe Checkout Session
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

    # ── Stripe Connect routing ───────────────────────────────────
    # Direct-charge model: the Session is created *in the merchant's
    # connected account* (via the stripe_account request option), and
    # the platform's cut comes out as application_fee_amount on the
    # PaymentIntent. Funds settle directly into the merchant's Stripe
    # balance and pay out on their schedule. Platform never holds the
    # money.
    #
    # Guard: if the seller hasn't finished OAuth OR Stripe says their
    # account isn't charges_enabled yet, we refuse up front. Better a
    # visible 400 than a stranded payment.
    merchant_stripe_id = _get_seller_stripe_connect_id(supabase, seller_user_id)
    if not merchant_stripe_id:
        print(
            f"[checkout] Refusing session: seller {seller_user_id} has no "
            f"stripe_connect_id in merchants table"
        )
        raise HTTPException(
            status_code=400,
            detail={
                "code": "merchant_stripe_not_connected",
                "message": (
                    "This merchant hasn't finished connecting their "
                    "Stripe account yet."
                ),
            },
        )
    _assert_merchant_can_receive(s, merchant_stripe_id)

    application_fee_cents = int(round(platform_fee * 100))

    print(
        f"[checkout] Creating Stripe session: offer={offer['id']}, "
        f"amount_cents={amount_cents}, buyer={buyer_user_id}, "
        f"merchant={merchant_stripe_id}, "
        f"application_fee_cents={application_fee_cents}"
    )

    try:
        payment_intent_data: dict = {}
        if application_fee_cents > 0:
            payment_intent_data["application_fee_amount"] = application_fee_cents
        if buyer_email:
            payment_intent_data["receipt_email"] = buyer_email

        session_params: dict = {
            "mode": "payment",
            "line_items": [{
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
            "metadata": {
                "offer_id": offer["id"],
                "buyer_user_id": buyer_user_id,
                "seller_user_id": seller_user_id,
                "project_id": project_id,
                "stripe_connect_account_id": merchant_stripe_id,
            },
            "success_url": _append_query_param(success_url, "checkout", "success"),
            "cancel_url": _append_query_param(cancel_url, "checkout", "cancelled"),
        }
        if buyer_email:
            session_params["customer_email"] = buyer_email
        if payment_intent_data:
            session_params["payment_intent_data"] = payment_intent_data

        # stripe_account is a Stripe SDK request option (becomes the
        # Stripe-Account HTTP header), not a payload field. Passing it
        # as a kwarg to Session.create makes the whole call execute
        # against the connected account — which is what direct charges
        # require.
        session = s.checkout.Session.create(
            **session_params,
            stripe_account=merchant_stripe_id,
        )
    except HTTPException:
        raise
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
        "source": body.source if body.source in ("normal", "live", "live_auction") else "normal",
    }

    print(f"[checkout] Inserting order: session_id={order_insert['stripe_session_id']}, pi={order_insert['stripe_payment_intent_id']}, status={order_insert['status']}")
    order_res = supabase.table("orders").insert(order_insert).execute()
    if not order_res.data:
        print("[checkout] ERROR: order insert returned no data")
        raise HTTPException(status_code=500, detail="Failed to create order record")

    order = order_res.data[0]
    print(f"[checkout] Order created: id={order['id']}")

    # Backfill order_id into Stripe session metadata for webhook reliability.
    # The session lives inside the merchant's connected account (direct
    # charges), so every subsequent Stripe API call for this session needs
    # the same stripe_account scoping.
    try:
        s.checkout.Session.modify(
            session.id,
            metadata={
                "offer_id": offer["id"],
                "buyer_user_id": buyer_user_id,
                "seller_user_id": seller_user_id,
                "project_id": project_id,
                "order_id": order["id"],
                "stripe_connect_account_id": merchant_stripe_id,
            },
            stripe_account=merchant_stripe_id,
        )
        print(f"[checkout] Session metadata updated with order_id={order['id']}")
    except Exception as meta_err:
        print(f"[checkout] Warning: could not update session metadata: {meta_err}")

    # Also set metadata on the Payment Intent so payment_intent.succeeded
    # webhooks can find the order without an extra Stripe API call. Same
    # connected-account scoping as above.
    if session.payment_intent:
        try:
            s.PaymentIntent.modify(
                session.payment_intent,
                metadata={
                    "offer_id": offer["id"],
                    "buyer_user_id": buyer_user_id,
                    "seller_user_id": seller_user_id,
                    "project_id": project_id,
                    "order_id": order["id"],
                    "stripe_connect_account_id": merchant_stripe_id,
                },
                stripe_account=merchant_stripe_id,
            )
            print(f"[checkout] Payment Intent metadata updated: PI={session.payment_intent}")
        except Exception as pi_meta_err:
            print(f"[checkout] Warning: could not update PI metadata: {pi_meta_err}")

    # If this is an auction payment, update auction status
    if body.auction_id:
        try:
            supabase.table("auctions").update({
                "status": "awaiting_payment",
                "winner_order_id": order["id"],
            }).eq("id", body.auction_id).eq("status", "ended").execute()
            print(f"[checkout] Auction {body.auction_id} → awaiting_payment")
        except Exception as auc_err:
            print(f"[checkout] Warning: could not update auction: {auc_err}")

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

    # ── Idempotency: skip already-processed events ──
    event_id = event["id"]
    try:
        existing = supabase.table("processed_webhook_events").select("event_id").eq("event_id", event_id).limit(1).execute()
        if existing.data:
            print(f"[webhook] Event {event_id} already processed, skipping")
            return JSONResponse(content={"received": True, "duplicate": True}, status_code=200)
    except Exception:
        pass  # Table may not exist yet — proceed without idempotency

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
        """Update order to paid, update inventory, award DUM, send emails."""
        order_id = order["id"]
        audit = {"order_id": order_id, "stripe_event_id": event_id, "source": source}

        if order["status"] not in ("pending_payment", "pending"):
            print(f"[webhook] Order {order_id} already {order['status']}, skipping")
            return

        # ── 1. Mark order paid ──
        update_fields: dict = {"status": "paid", "updated_at": _now_iso()}
        if session_id:
            update_fields["stripe_session_id"] = session_id
        if pi_id:
            update_fields["stripe_payment_intent_id"] = pi_id

        supabase.table("orders").update(update_fields).eq("id", order_id).execute()
        print(f"[webhook] ✓ ORDER PAID: {order_id}")
        audit["order_paid"] = True

        # ── 2. Update inventory ──
        offer_id = order.get("offer_id")
        # Resolve project_id early for broadcast
        _proj_id_for_broadcast = ""
        if offer_id:
            try:
                offer_res = supabase.table("offers").select("id, project_id, quantity_sold, quantity_available, unlimited_inventory").eq("id", offer_id).limit(1).execute()
                if offer_res.data:
                    o = offer_res.data[0]
                    new_sold = (o.get("quantity_sold") or 0) + 1
                    qty_available = o.get("quantity_available") or 0
                    is_unlimited = o.get("unlimited_inventory", True)
                    supabase.table("offers").update({"quantity_sold": new_sold}).eq("id", offer_id).execute()
                    print(f"[webhook] ✓ INVENTORY: offer={offer_id}, sold → {new_sold}")
                    audit["inventory_updated"] = True
                    _proj_id_for_broadcast = o.get("project_id") or ""

                    # Broadcast real-time inventory update to all connected clients
                    sold_out = not is_unlimited and qty_available > 0 and new_sold >= qty_available
                    broadcast_sync(_proj_id_for_broadcast, {
                        "type": "item_updated",
                        "data": {
                            "offer_id": offer_id,
                            "quantity_sold": new_sold,
                            "quantity_available": qty_available,
                            "unlimited_inventory": is_unlimited,
                            "sold_out": sold_out,
                        },
                        "timestamp": time.time(),
                    })
                    if sold_out:
                        broadcast_sync(_proj_id_for_broadcast, {
                            "type": "item_sold",
                            "data": {"offer_id": offer_id, "title": "Item"},
                            "timestamp": time.time(),
                        })
                    print(f"[webhook] ✓ BROADCAST: item_updated for offer={offer_id}, sold_out={sold_out}")
            except Exception as inv_err:
                print(f"[webhook] ✗ Inventory update failed (non-fatal): {inv_err}")

        # ── 3. Resolve order details for reward + email ──
        dum_reward = 0
        new_dum = 0
        buyer_email = ""
        seller_email = ""
        offer_title = "Order"
        amount = 0.0
        seller_receives_val = 0.0
        proj_name = ""
        proj_id = ""
        buyer_uid = ""

        try:
            full_order = supabase.table("orders").select("*, offers(title, price_usd, project_id)").eq("id", order_id).single().execute()
            od = full_order.data or {}
            offer_data = od.get("offers") or {}
            offer_title = offer_data.get("title", "Order")
            amount = float(od.get("amount_paid_usd", 0))
            seller_receives_val = float(od.get("seller_receives_usd", 0))
            proj_id = od.get("project_id", "")
            buyer_uid = od.get("buyer_user_id", "")

            if proj_id:
                proj_res = supabase.table("projects").select("title, name").eq("id", proj_id).limit(1).execute()
                if proj_res.data:
                    proj_name = proj_res.data[0].get("title") or proj_res.data[0].get("name") or ""

            # Resolve buyer email
            buyer_email = od.get("buyer_email") or ""
            if not buyer_email and buyer_uid:
                u_res = supabase.table("users").select("email").eq("privy_id", buyer_uid).limit(1).execute()
                if u_res.data:
                    buyer_email = u_res.data[0].get("email") or ""

            # Resolve seller email
            seller_uid = od.get("seller_user_id")
            if seller_uid:
                prof_res = supabase.table("profiles").select("wallet_address").eq("id", seller_uid).limit(1).execute()
                if prof_res.data:
                    wallet = prof_res.data[0].get("wallet_address")
                    if wallet:
                        u_res = supabase.table("users").select("email").eq("wallet_address", wallet).limit(1).execute()
                        if u_res.data:
                            seller_email = u_res.data[0].get("email") or ""
        except Exception as detail_err:
            print(f"[webhook] Order detail resolve error (non-fatal): {detail_err}")

        # ── 4. Award DUM (payment is already confirmed — this is safe) ──
        if buyer_uid:
            try:
                dum_reward = min(50, 10 + int(amount / 5))
                dum_res = supabase.table("users").select("dum_balance").eq("privy_id", buyer_uid).limit(1).execute()
                if dum_res.data:
                    cur_dum = dum_res.data[0].get("dum_balance", 0)
                    new_dum = cur_dum + dum_reward
                    supabase.table("users").update({"dum_balance": new_dum}).eq("privy_id", buyer_uid).execute()
                    supabase.table("dum_transactions").insert({
                        "privy_id": buyer_uid, "amount": dum_reward,
                        "reason": "purchase_reward", "reference_id": order_id,
                        "balance_after": new_dum,
                    }).execute()
                    print(f"[webhook] ✓ DUM AWARDED: {dum_reward} to {buyer_uid} (spent ${amount:.2f}) → balance {new_dum}")
                    audit["dum_awarded"] = dum_reward
                    audit["dum_balance"] = new_dum
            except Exception as dum_err:
                print(f"[webhook] ✗ DUM award failed (non-fatal): {dum_err}")

        # ── 5. Send emails (never blocks payment processing) ──
        # Single combined buyer email (confirmation + DUM reward)
        try:
            if buyer_email:
                from services.email import send_buyer_payment_confirmed
                send_buyer_payment_confirmed(buyer_email, offer_title, amount, proj_name)
                print(f"[webhook] ✓ BUYER EMAIL sent to {buyer_email} (includes DUM reward messaging)")
                audit["buyer_email_sent"] = True
            else:
                print(f"[webhook] ⊘ Buyer email skipped (no email)")
        except Exception as buyer_email_err:
            print(f"[webhook] ✗ Buyer email failed (non-fatal): {buyer_email_err}")

        try:
            if seller_email:
                send_seller_new_order(seller_email, offer_title, amount, seller_receives_val, proj_id)
                print(f"[webhook] ✓ SELLER EMAIL sent to {seller_email}")
                audit["seller_email_sent"] = True
            else:
                print(f"[webhook] ⊘ Seller email skipped (no email)")
        except Exception as seller_email_err:
            print(f"[webhook] ✗ Seller email failed (non-fatal): {seller_email_err}")

        # ── 6. Audit trail ──
        print(f"[webhook] ═══ AUDIT: {audit}")

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

        # ── DUM Points purchase (not an offer order) ──
        if metadata.get("purchase_type") == "dum_points":
            privy_id = metadata.get("privy_id")
            points_amount = int(metadata.get("points_amount", "0"))
            if privy_id and points_amount > 0:
                try:
                    user_res = supabase.table("users").select("dum_balance").eq("privy_id", privy_id).limit(1).execute()
                    if user_res.data:
                        current = user_res.data[0].get("dum_balance", 0)
                        new_balance = current + points_amount
                        supabase.table("users").update({"dum_balance": new_balance}).eq("privy_id", privy_id).execute()
                        supabase.table("dum_transactions").insert({
                            "privy_id": privy_id, "amount": points_amount,
                            "reason": "stripe_purchase", "reference_id": session_id,
                            "balance_after": new_balance,
                        }).execute()
                        print(f"[webhook] ✓ DUM Points purchased: {points_amount} to {privy_id} → {new_balance}")

                        # Best-effort: mint SPL tokens on-chain
                        try:
                            from services.solana_mint import mint_dum_to_wallet, is_solana_enabled
                            if is_solana_enabled():
                                wallet_res = supabase.table("users").select("wallet_address").eq("privy_id", privy_id).limit(1).execute()
                                wallet = wallet_res.data[0].get("wallet_address") if wallet_res.data else None
                                if wallet:
                                    mint_dum_to_wallet(wallet, points_amount)
                        except Exception as mint_err:
                            print(f"[webhook] on-chain mint failed (non-fatal): {mint_err}")
                    else:
                        print(f"[webhook] ✗ User not found for DUM Points: {privy_id}")
                except Exception as exc:
                    print(f"[webhook] ✗ DUM Points award failed: {exc!r}")
            else:
                print(f"[webhook] ✗ Invalid DUM Points metadata: privy_id={privy_id}, points={points_amount}")
            return JSONResponse(content={"received": True}, status_code=200)

        # ── Regular offer order ──
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

    elif event["type"] == "account.updated":
        # Connected-account verification events. Fires whenever Stripe
        # advances a Connect account's state — identity review clears,
        # requirements change, or the account is disabled. We sync the
        # cached merchants.stripe_connect_status column so the merchant
        # dashboard reflects reality without a live Account.retrieve on
        # every page render.
        #
        # Status vocabulary:
        #   "verified"             — charges_enabled AND no outstanding
        #                            requirements.currently_due
        #   "restricted"           — Stripe has disabled the account
        #                            (requirements.disabled_reason set)
        #   "pending_verification" — anything else (e.g. partial review,
        #                            docs uploaded but not yet reviewed)
        account = event["data"]["object"]
        acct_id = account.get("id")
        charges_enabled = bool(account.get("charges_enabled", False))
        payouts_enabled = bool(account.get("payouts_enabled", False))
        requirements = account.get("requirements") or {}
        currently_due = requirements.get("currently_due") or []
        disabled_reason = requirements.get("disabled_reason")

        if disabled_reason:
            new_status = "restricted"
        elif charges_enabled and not currently_due:
            new_status = "verified"
        else:
            new_status = "pending_verification"

        print(
            f"[webhook] account.updated: acct={acct_id}, "
            f"charges_enabled={charges_enabled}, payouts_enabled={payouts_enabled}, "
            f"currently_due={currently_due}, disabled_reason={disabled_reason}, "
            f"→ status={new_status}"
        )

        if acct_id:
            try:
                supabase.table("merchants").update({
                    "stripe_connect_status": new_status,
                }).eq("stripe_connect_id", acct_id).execute()
                print(f"[webhook] ✓ merchants.stripe_connect_status → {new_status} for {acct_id}")
            except Exception as exc:
                print(f"[webhook] ✗ Failed to update merchants row for {acct_id}: {exc!r}")

    else:
        print(f"[webhook] Unhandled event: {event['type']}")

    # Record event as processed for idempotency
    try:
        supabase.table("processed_webhook_events").insert({
            "event_id": event_id,
            "event_type": event["type"],
        }).execute()
    except Exception:
        pass  # Non-fatal — duplicate check on next attempt

    print(f"[webhook] ========== WEBHOOK DONE ==========")
    return JSONResponse(content={"received": True}, status_code=200)


# ── Public: Recent Sales Feed ─────────────────────────────────

@router.get("/recent-sales")
async def recent_sales(limit: int = 10):
    """Public endpoint: recent paid/fulfilled orders for social proof.

    Filters out sales whose underlying project is soft-hidden via the
    `visibility='hidden'` flag (migration 029_project_visibility). This
    is what stops founder demo storefronts — e.g. Silver Market Hub,
    Date Night Box Co., Sparkle Pro Mobile Wash, GrowthKit — from
    showing up in the homepage LiveActivityTicker after they've been
    hidden from /discover. Social proof must match public listing
    semantics, or the ticker contradicts the directory.

    To keep the visible count close to the requested `limit` after
    filtering, we fetch a larger internal window (5x the requested
    limit, capped at 100) and slice to `limit` post-filter.
    """
    supabase = get_client()
    try:
        # Larger internal fetch so post-filtering still leaves enough
        # rows to satisfy the requested limit.
        db_limit = min(max(limit * 5, 50), 100)
        res = (
            supabase.table("orders")
            .select(
                "id, amount_paid_usd, status, created_at, "
                "offers(title, project_id, projects(title, visibility))"
            )
            .in_("status", ["paid", "fulfilled"])
            .order("created_at", desc=True)
            .limit(db_limit)
            .execute()
        )
        sales = []
        for row in (res.data or []):
            offer = row.get("offers") or {}
            project = offer.get("projects") or {}
            # Hard-exclude sales whose project is hidden from the public
            # directory. Orphaned sales (null project) are included —
            # they can't be affirmatively hidden, so we default to
            # showing them rather than silently swallowing them.
            if project.get("visibility") == "hidden":
                continue
            sales.append({
                "id": row["id"],
                "amount": float(row.get("amount_paid_usd", 0)),
                "offer_title": offer.get("title", ""),
                "business_name": project.get("title", ""),
                "status": row.get("status", ""),
                "created_at": row.get("created_at", ""),
            })
            if len(sales) >= limit:
                break
        return {"sales": sales}
    except Exception as exc:
        print(f"[checkout] recent-sales error: {exc!r}")
        return {"sales": []}


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
