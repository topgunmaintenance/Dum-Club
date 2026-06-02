"""
Checkout — Stripe payment intents, webhook, Solana wallet checkout,
and order queries.
"""
import os
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from urllib.parse import urlparse, urlunparse, urlencode, parse_qs

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from db.supabase import get_client
from auth.privy import get_current_user, get_optional_current_user, require_admin
from services.commission import CommissionRateUnset, resolve_commission_rate
from services.email import send_buyer_payment_confirmed, send_seller_new_order, send_buyer_fulfilled
from services.solana_verify import (
    LAMPORTS_PER_SOL,
    QuoteVerifyError,
    make_quote_token,
    usd_to_lamports,
    verify_quote_token,
    verify_sol_transfer,
)
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
    bypassed. Hard-disabled whenever STRIPE_SECRET_KEY is sk_live_*,
    regardless of ENVIRONMENT or STRIPE_TEST_MODE — the bypass must
    never run against live Stripe, even if the env vars request it.
    """
    requested = _ENVIRONMENT == "development" or _STRIPE_TEST_MODE
    if requested and _STRIPE_SECRET.startswith("sk_live_"):
        print(
            "[checkout] ⚠ IGNORING verification bypass: "
            f"ENVIRONMENT={_ENVIRONMENT!r} STRIPE_TEST_MODE={_STRIPE_TEST_MODE} "
            f"but STRIPE_SECRET_KEY is sk_live_*. Bypass disabled in production."
        )
        return False
    return requested


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

# Commission rate is resolved per-merchant via services.commission at
# session-create time. Resolution order: merchants.commission_rate_override
# -> plan_limits.commission_rate (via merchants.plan_id) -> fail closed.
# Today doctrine is 0% — both the per-tier seed (migration 053) and the
# absence of any non-NULL override mean the resolver returns Decimal("0.0000")
# for every existing merchant. The wiring stays general so a per-merchant
# override or a future tier-rate change Just Works without touching this
# code path.


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
    state says the merchant can actually accept charges AND get paid
    out. Both flags matter: charges_enabled=true with payouts_enabled=
    false means funds collect on Stripe's side but can never settle
    to the merchant's bank — the worst possible state for a flat-fee
    direct-charge model.

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

    charges_enabled = bool(getattr(account, "charges_enabled", False))
    payouts_enabled = bool(getattr(account, "payouts_enabled", False))

    if not (charges_enabled and payouts_enabled):
        currently_due = []
        try:
            reqs = getattr(account, "requirements", None)
            if reqs is not None:
                currently_due = list(getattr(reqs, "currently_due", []) or [])
        except Exception:
            currently_due = []

        # Dev/test bypass: when ENVIRONMENT=development or
        # STRIPE_TEST_MODE=true (and the secret key is sk_test_*),
        # allow checkout to proceed against an unverified Connect
        # account so we can smoke-test the full payment flow while
        # Stripe's review is pending. Hard-disabled when the secret
        # key is sk_live_* — see _checkout_verification_bypass_allowed.
        if _checkout_verification_bypass_allowed():
            print(
                f"[checkout] ⚠ BYPASS verification gate: merchant={connect_id} "
                f"charges_enabled={charges_enabled} payouts_enabled={payouts_enabled} "
                f"ENVIRONMENT={_ENVIRONMENT!r} STRIPE_TEST_MODE={_STRIPE_TEST_MODE} "
                f"currently_due={currently_due}. "
                f"Bypass MUST NOT be enabled with live Stripe keys."
            )
            return

        print(
            f"[checkout] Merchant {connect_id} cannot accept payments: "
            f"charges_enabled={charges_enabled} payouts_enabled={payouts_enabled} "
            f"currently_due={currently_due}"
        )
        raise HTTPException(
            status_code=400,
            detail={
                "code": "merchant_stripe_not_verified",
                "message": (
                    "Stripe onboarding is not complete yet. "
                    "Finish Stripe verification before accepting "
                    "live payments."
                ),
                "charges_enabled": charges_enabled,
                "payouts_enabled": payouts_enabled,
                "requirements_due": currently_due,
            },
        )


# ── Shared paid-order side-effects ────────────────────────────
#
# Lifted out of the Stripe webhook handler so the Solana checkout
# path can run the SAME post-payment side-effects (mark paid,
# bump inventory, broadcast item_updated/item_sold, award DUM
# Points, send buyer + seller emails) without code duplication.
#
# Behaviour is intentionally identical to the previous closure
# implementation. Don't change the audit log keys, error swallow
# pattern, or DUM reward formula here — Stripe-path tests and
# downstream dashboards depend on them.


def process_order_paid(
    supabase,
    order: dict,
    *,
    stripe_session_id: str = "",
    stripe_payment_intent_id: str = "",
    event_id: str = "",
    source: str = "",
) -> None:
    """Update order to paid, update inventory, award DUM, send emails.

    Args:
        supabase:                  Supabase client (sync). Caller-supplied
                                   so tests can inject a mock.
        order:                     The current `orders` row dict — must
                                   carry id, status, offer_id, etc.
        stripe_session_id:         Stripe Checkout Session id, if any.
                                   Set on the order if non-empty.
        stripe_payment_intent_id:  Stripe PaymentIntent id, if any.
                                   Set on the order if non-empty.
        event_id:                  Originating event id (Stripe event
                                   or SOL tx signature) — audit only.
        source:                    Audit label, e.g.
                                   "checkout.session.completed",
                                   "payment_intent.succeeded",
                                   "sol_confirm".
    """
    order_id = order["id"]
    audit = {"order_id": order_id, "event_id": event_id, "source": source}

    if order["status"] not in ("pending_payment", "pending"):
        print(f"[paid] Order {order_id} already {order['status']}, skipping")
        return

    # ── 1. Mark order paid ──
    update_fields: dict = {"status": "paid", "updated_at": _now_iso()}
    if stripe_session_id:
        update_fields["stripe_session_id"] = stripe_session_id
    if stripe_payment_intent_id:
        update_fields["stripe_payment_intent_id"] = stripe_payment_intent_id

    supabase.table("orders").update(update_fields).eq("id", order_id).execute()
    print(f"[paid] ✓ ORDER PAID: {order_id}")
    audit["order_paid"] = True

    # Drive Your Market Analytics — write a `purchase_completed` event so
    # the funnel rate (visitors → checkout starts → purchases) lines up
    # against the order. Best-effort; never raise from analytics.
    try:
        amount_usd = order.get("amount_paid_usd") or 0
        amount_cents = int(round(float(amount_usd) * 100)) if amount_usd else None
        supabase.table("merchant_analytics_events").insert({
            "event_type": "purchase_completed",
            "project_id": order.get("project_id"),
            "offer_id": order.get("offer_id"),
            "order_id": order_id,
            "amount_cents": amount_cents,
        }).execute()
    except Exception:
        pass

    # ── 2. Update inventory ──
    offer_id = order.get("offer_id")
    _proj_id_for_broadcast = ""
    if offer_id:
        try:
            offer_res = supabase.table("offers").select(
                "id, title, project_id, quantity_sold, quantity_available, unlimited_inventory"
            ).eq("id", offer_id).limit(1).execute()
            if offer_res.data:
                o = offer_res.data[0]
                new_sold = (o.get("quantity_sold") or 0) + 1
                qty_available = o.get("quantity_available") or 0
                is_unlimited = o.get("unlimited_inventory", True)
                offer_title = o.get("title") or "Item"
                supabase.table("offers").update(
                    {"quantity_sold": new_sold}
                ).eq("id", offer_id).execute()
                print(f"[paid] ✓ INVENTORY: offer={offer_id}, sold → {new_sold}")
                audit["inventory_updated"] = True
                _proj_id_for_broadcast = o.get("project_id") or ""

                # Broadcast real-time inventory update to all connected clients
                sold_out = (
                    not is_unlimited
                    and qty_available > 0
                    and new_sold >= qty_available
                )
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
                # Sale-celebration broadcast — fires on EVERY paid sale,
                # not only sold-out, so the embed's toast + emoji burst
                # (Step 8 of the embed build, wired to onItemSold) renders
                # on every purchase. The sold_out boolean above stays
                # carried inside item_updated for inventory sync; this
                # event is purely for the celebration UI. Title comes
                # from the offers row, not a hardcoded placeholder.
                broadcast_sync(_proj_id_for_broadcast, {
                    "type": "item_sold",
                    "data": {"offer_id": offer_id, "title": offer_title},
                    "timestamp": time.time(),
                })
                print(f"[paid] ✓ BROADCAST: item_updated + item_sold for offer={offer_id} ({offer_title}), sold_out={sold_out}")
        except Exception as inv_err:
            print(f"[paid] ✗ Inventory update failed (non-fatal): {inv_err}")

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
        full_order = supabase.table("orders").select(
            "*, offers(title, price_usd, project_id)"
        ).eq("id", order_id).single().execute()
        od = full_order.data or {}
        offer_data = od.get("offers") or {}
        offer_title = offer_data.get("title", "Order")
        amount = float(od.get("amount_paid_usd", 0))
        seller_receives_val = float(od.get("seller_receives_usd", 0))
        proj_id = od.get("project_id", "")
        buyer_uid = od.get("buyer_user_id", "")

        if proj_id:
            proj_res = supabase.table("projects").select(
                "title, name"
            ).eq("id", proj_id).limit(1).execute()
            if proj_res.data:
                proj_name = (
                    proj_res.data[0].get("title")
                    or proj_res.data[0].get("name")
                    or ""
                )

        # Resolve buyer email
        buyer_email = od.get("buyer_email") or ""
        if not buyer_email and buyer_uid:
            u_res = supabase.table("users").select(
                "email"
            ).eq("privy_id", buyer_uid).limit(1).execute()
            if u_res.data:
                buyer_email = u_res.data[0].get("email") or ""

        # Resolve seller email
        seller_uid = od.get("seller_user_id")
        if seller_uid:
            prof_res = supabase.table("profiles").select(
                "wallet_address"
            ).eq("id", seller_uid).limit(1).execute()
            if prof_res.data:
                wallet = prof_res.data[0].get("wallet_address")
                if wallet:
                    u_res = supabase.table("users").select(
                        "email"
                    ).eq("wallet_address", wallet).limit(1).execute()
                    if u_res.data:
                        seller_email = u_res.data[0].get("email") or ""
    except Exception as detail_err:
        print(f"[paid] Order detail resolve error (non-fatal): {detail_err}")

    # ── 4. Award DUM (payment is already confirmed — this is safe) ──
    if buyer_uid:
        try:
            dum_reward = min(50, 10 + int(amount / 5))
            dum_res = supabase.table("users").select(
                "dum_balance"
            ).eq("privy_id", buyer_uid).limit(1).execute()
            if dum_res.data:
                cur_dum = dum_res.data[0].get("dum_balance", 0)
                new_dum = cur_dum + dum_reward
                supabase.table("users").update(
                    {"dum_balance": new_dum}
                ).eq("privy_id", buyer_uid).execute()
                supabase.table("dum_transactions").insert({
                    "privy_id": buyer_uid,
                    "amount": dum_reward,
                    "reason": "purchase_reward",
                    "reference_id": order_id,
                    "balance_after": new_dum,
                }).execute()
                print(
                    f"[paid] ✓ DUM AWARDED: {dum_reward} to {buyer_uid} "
                    f"(spent ${amount:.2f}) → balance {new_dum}"
                )
                audit["dum_awarded"] = dum_reward
                audit["dum_balance"] = new_dum
        except Exception as dum_err:
            print(f"[paid] ✗ DUM award failed (non-fatal): {dum_err}")

    # ── 5. Send emails (never blocks payment processing) ──
    try:
        if buyer_email:
            send_buyer_payment_confirmed(buyer_email, offer_title, amount, proj_name)
            print(f"[paid] ✓ BUYER EMAIL sent to {buyer_email}")
            audit["buyer_email_sent"] = True
        else:
            print(f"[paid] ⊘ Buyer email skipped (no email)")
    except Exception as buyer_email_err:
        print(f"[paid] ✗ Buyer email failed (non-fatal): {buyer_email_err}")

    try:
        if seller_email:
            send_seller_new_order(seller_email, offer_title, amount, seller_receives_val, proj_id)
            print(f"[paid] ✓ SELLER EMAIL sent to {seller_email}")
            audit["seller_email_sent"] = True
        else:
            print(f"[paid] ⊘ Seller email skipped (no email)")
    except Exception as seller_email_err:
        print(f"[paid] ✗ Seller email failed (non-fatal): {seller_email_err}")

    # ── 6. Audit trail ──
    print(f"[paid] ═══ AUDIT: {audit}")


# ── Payment Intent ────────────────────────────────────────────

@router.post("/create-payment-intent")
async def create_payment_intent(
    body: PaymentIntentRequest,
    current_user: Optional[dict] = Depends(get_optional_current_user),
):
    if not _STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    print(f"[checkout] Request: offer_id={body.offer_id}, source={body.source}, auction_id={body.auction_id}, override_price={body.override_price}, use_dum_discount={body.use_dum_discount}")

    supabase = get_client()
    # Guest checkout: when the caller isn't signed in, mint a
    # synthetic buyer id so downstream order rows (which have
    # buyer_user_id NOT NULL) can be created without an account.
    # Stripe Checkout captures the real email at the payment step;
    # the webhook handler reconciles that back to the order. Auth
    # is now optional, but a TAMPERED token still 401s upstream
    # via verify_privy_token — so we never silently accept a bad
    # token as a guest.
    import secrets as _secrets
    privy_id = (current_user or {}).get("sub")
    is_guest = not privy_id
    if is_guest:
        privy_id = f"guest:{_secrets.token_urlsafe(12)}"
    print(f"[checkout] Buyer: privy_id={privy_id} guest={is_guest}")

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
    # Guests (synthetic privy_id starting with "guest:") never have
    # a DUM balance row, so short-circuit cleanly — saves a useless
    # users lookup and avoids any chance of a "no such user"
    # error being treated as an empty balance.
    if body.use_dum_discount and privy_id and not is_guest:
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

    # Seller payout based on ORIGINAL price (platform subsidizes DUM discount).
    # Actual platform_fee / seller_receives are computed below, AFTER the
    # merchant has been resolved and the commission rate is known. The
    # buyer-paid amount in cents is locked here so the Stripe minimum check
    # can run before any further work.
    seller_payout_base = original_price if token_discount_applied else final_price
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

    # 5. Resolve buyer email for Stripe receipt. Guests have no
    # users row — skip the lookup, Stripe Checkout will collect
    # the email on the payment page (default behaviour when
    # customer_email is not passed in session create).
    buyer_email = body.buyer_email
    if not buyer_email and privy_id and not is_guest:
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
    # Suspension gate (Phase 2 grace-period rollout). Suspended merchants
    # cannot take new orders even if their Stripe Connect account is
    # otherwise verified — the platform plan they pay us for is paused.
    # Dashboard stays accessible so they can fix their card.
    from api.routes.merchant import is_merchant_suspended
    if is_merchant_suspended(seller_user_id):
        print(f"[checkout] Refusing session: seller {seller_user_id} is suspended (payment grace expired)")
        raise HTTPException(
            status_code=402,
            detail={
                "code": "merchant_suspended",
                "message": (
                    "This shop is paused while the owner updates their "
                    "payment method. New orders are off right now."
                ),
            },
        )

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
                    "Stripe onboarding is not complete yet. "
                    "Finish Stripe verification before accepting "
                    "live payments."
                ),
            },
        )
    _assert_merchant_can_receive(s, merchant_stripe_id)

    # ── Commission resolution (PR-COMM) ──────────────────────────
    # Resolve the per-merchant commission rate, then derive the integer
    # cents value passed to Stripe as application_fee_amount. Computed in
    # Decimal — never float — to keep cents math exact.
    #
    # Fail closed: if the resolver raises, refuse the session. Better a
    # visible 503 than silently defaulting to "free" or "1%". The
    # resolver returns Decimal("0.0000") for the doctrine-correct path
    # today; the omit-when-zero branch below preserves the existing
    # Stripe-call shape for that case.
    try:
        commission_rate = resolve_commission_rate(seller_user_id, supabase=supabase)
    except CommissionRateUnset as exc:
        print(f"[checkout] Refusing session: {exc}")
        raise HTTPException(
            status_code=503,
            detail={
                "code": "commission_rate_unset",
                "message": (
                    "Checkout is misconfigured: this merchant has no "
                    "commission rate set. Contact support."
                ),
            },
        )

    seller_payout_cents = int(round(seller_payout_base * 100))
    application_fee_dec = (
        Decimal(seller_payout_cents) * commission_rate
    ).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    application_fee_cents = int(application_fee_dec)
    platform_fee = float(application_fee_dec) / 100.0
    seller_receives = float(Decimal(seller_payout_cents) - application_fee_dec) / 100.0

    print(
        f"[checkout] Creating Stripe session: offer={offer['id']}, "
        f"amount_cents={amount_cents}, buyer={buyer_user_id}, "
        f"merchant={merchant_stripe_id}, "
        f"commission_rate={commission_rate}, "
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
            # Stripe-visible metadata. The fee fields below carry the
            # product-side name "Marketplace Fee" so the Stripe Dashboard
            # readers (operator, merchant viewing their connected account)
            # see the same vocabulary the merchant UI uses. The Stripe
            # API still treats the deduction as `application_fee_amount`
            # at the PaymentIntent level — Stripe's label is fixed.
            "metadata": {
                "offer_id": offer["id"],
                "buyer_user_id": buyer_user_id,
                "seller_user_id": seller_user_id,
                "project_id": project_id,
                "stripe_connect_account_id": merchant_stripe_id,
                "gross_sale_cents": str(amount_cents),
                "marketplace_fee_cents": str(application_fee_cents),
                "marketplace_fee_percent": f"{float(commission_rate) * 100:.2f}",
                "seller_receives_cents": str(seller_payout_cents - application_fee_cents),
                "fee_label": "DUM Club Marketplace Fee",
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
        "resolved_commission_rate": float(commission_rate),
        "application_fee_amount_cents": application_fee_cents,
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
                "gross_sale_cents": str(amount_cents),
                "marketplace_fee_cents": str(application_fee_cents),
                "marketplace_fee_percent": f"{float(commission_rate) * 100:.2f}",
                "seller_receives_cents": str(seller_payout_cents - application_fee_cents),
                "fee_label": "DUM Club Marketplace Fee",
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

    # ── Idempotency: atomically CLAIM the event before any side effects ──
    # Replaces the previous check-then-act (SELECT, process, then INSERT at
    # the end), which had two gaps at volume: (1) two concurrent deliveries
    # of the same event could both pass the SELECT before either inserted,
    # double-processing; (2) the record was only written at the END, so a
    # crash mid-handler left no row and Stripe's retry reprocessed. We now
    # insert the event_id up front — the event_id PRIMARY KEY makes this an
    # atomic claim. A unique-violation means another delivery already owns
    # the event, so we ack 200 and skip.
    #
    # Accepted trade-off (per the "minimal atomic claim" scope): if
    # processing crashes AFTER this claim, the event stays claimed and a
    # Stripe retry is deduped rather than reprocessed. The order path is
    # separately guarded by process_order_paid's status check, and full
    # status-tracking (received/processing/done/failed + manual retry) is a
    # documented follow-up.
    event_id = event["id"]
    try:
        supabase.table("processed_webhook_events").insert({
            "event_id": event_id,
            "event_type": event["type"],
        }).execute()
    except Exception as claim_exc:
        msg = f"{getattr(claim_exc, 'code', '')} {claim_exc}".lower()
        is_duplicate = (
            "23505" in msg
            or "duplicate" in msg
            or "already exists" in msg
            or "conflict" in msg
            or "unique" in msg
        )
        if is_duplicate:
            print(f"[webhook] Event {event_id} already claimed, skipping")
            return JSONResponse(content={"received": True, "duplicate": True}, status_code=200)
        # Non-conflict error (e.g. table missing / transient). Degrade to
        # processing without idempotency — same posture as the prior
        # best-effort behavior — rather than dropping the event.
        print(f"[webhook] claim insert non-conflict error, proceeding without idempotency: {claim_exc!r}")

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
        """Stripe-webhook closure that delegates to the shared
        process_order_paid helper. Behaviour unchanged — kept as a
        thin wrapper so the surrounding event-routing code (lines
        below) continues to read naturally."""
        process_order_paid(
            supabase,
            order,
            stripe_session_id=session_id,
            stripe_payment_intent_id=pi_id,
            event_id=event_id,
            source=source,
        )

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
        details_submitted = bool(account.get("details_submitted", False))
        requirements = account.get("requirements") or {}
        currently_due = requirements.get("currently_due") or []
        eventually_due = requirements.get("eventually_due") or []
        disabled_reason = requirements.get("disabled_reason")

        # Match the merchant.py status endpoint: "verified" requires
        # the full set of live-payment guarantees so checkout/go-live
        # gates downstream stay closed until the account is truly
        # ready to receive money AND pay out.
        if disabled_reason:
            new_status = "restricted"
        elif charges_enabled and payouts_enabled and details_submitted and not currently_due:
            new_status = "verified"
        else:
            new_status = "pending_verification"

        print(
            f"[webhook] account.updated: acct={acct_id}, "
            f"charges_enabled={charges_enabled}, payouts_enabled={payouts_enabled}, "
            f"details_submitted={details_submitted}, "
            f"currently_due={currently_due}, eventually_due={eventually_due}, "
            f"disabled_reason={disabled_reason}, "
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

    elif event["type"] in (
        "customer.subscription.trial_will_end",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
    ):
        # Platform-side recurring billing (separate from merchant payouts
        # above). The merchants row carries cached trial/subscription state
        # so the dashboard countdown doesn't have to round-trip Stripe.
        # Refresh from authoritative Stripe state on every relevant event.
        sub = event["data"]["object"]
        sub_id = sub.get("id")
        from datetime import datetime, timezone
        if sub_id:
            update: dict = {"subscription_status": sub.get("status")}
            if sub.get("trial_end"):
                update["trial_ends_at"] = datetime.fromtimestamp(
                    sub["trial_end"], tz=timezone.utc
                ).isoformat()
            if sub.get("current_period_end"):
                update["next_billing_at"] = datetime.fromtimestamp(
                    sub["current_period_end"], tz=timezone.utc
                ).isoformat()
            try:
                supabase.table("merchants").update(update).eq(
                    "stripe_subscription_id", sub_id
                ).execute()
                print(
                    f"[webhook] ✓ {event['type']} sub={sub_id} → "
                    f"status={update.get('subscription_status')} "
                    f"trial_ends_at={update.get('trial_ends_at')}"
                )
            except Exception as exc:
                print(f"[webhook] ✗ subscription update failed sub={sub_id}: {exc!r}")

    elif event["type"] in ("invoice.payment_failed", "invoice.paid"):
        # Dunning / receipt events. invoice.paid is the canonical "trial
        # converted to paid" moment; invoice.payment_failed is the start of
        # the grace period before Stripe pauses or cancels.
        invoice = event["data"]["object"]
        sub_id = invoice.get("subscription")
        if sub_id:
            from datetime import datetime as _dt2, timedelta as _td2, timezone as _tz2
            new_status = "past_due" if event["type"] == "invoice.payment_failed" else "active"
            update: dict = {"subscription_status": new_status}
            if event["type"] == "invoice.payment_failed":
                # Open the 3-day grace window. Idempotent re-fire of the
                # same event resets the window to NOW + 3d — Stripe's
                # default dunning cadence is 1/3/5/7 days so the second
                # failure landing in the original grace window slides the
                # deadline forward, giving the merchant a fresh 3 days
                # from the latest attempt.
                grace_start = _dt2.now(_tz2.utc)
                grace_end = grace_start + _td2(days=3)
                update["grace_period_starts_at"] = grace_start.isoformat()
                update["grace_period_ends_at"] = grace_end.isoformat()
            else:
                # invoice.paid — payment recovered. Clear the grace window.
                update["grace_period_starts_at"] = None
                update["grace_period_ends_at"] = None
            try:
                supabase.table("merchants").update(update).eq(
                    "stripe_subscription_id", sub_id
                ).execute()
                print(f"[webhook] ✓ {event['type']} sub={sub_id} → status={new_status}")
            except Exception as exc:
                print(f"[webhook] ✗ invoice event update failed sub={sub_id}: {exc!r}")

            # Fire the corresponding reminder email through the same
            # idempotent insert-log-then-send path the daily cron uses.
            # Founding/grandfathered rows are excluded by the merchant
            # lookup below (they never have a stripe_subscription_id in
            # the first place, but we double-check the flag to be sure).
            try:
                from datetime import datetime as _dt, timedelta as _td, timezone as _tz
                from services.agents.trial_reminders import (
                    send_reminder_once,
                    _plan_price_for,
                )
                from services.email import (
                    send_trial_conversion_confirmed,
                    send_payment_failed_notice,
                )
                m_res = (
                    supabase.table("merchants")
                    .select("id, owner_privy_id, business_name, "
                            "subscription_price_id, grandfathered")
                    .eq("stripe_subscription_id", sub_id)
                    .limit(1)
                    .execute()
                )
                m_row = (m_res.data or [None])[0]
                if m_row and not m_row.get("grandfathered"):
                    email = None
                    if m_row.get("owner_privy_id"):
                        u_res = (
                            supabase.table("users")
                            .select("email")
                            .eq("privy_id", m_row["owner_privy_id"])
                            .limit(1)
                            .execute()
                        )
                        if u_res.data:
                            email = (u_res.data[0] or {}).get("email")
                    plan_price = _plan_price_for(m_row.get("subscription_price_id"))
                    if email:
                        if event["type"] == "invoice.paid":
                            send_reminder_once(
                                m_row["id"], "conversion_confirmed",
                                send_trial_conversion_confirmed,
                                email, m_row.get("business_name") or "", plan_price,
                            )
                        else:  # invoice.payment_failed
                            # Use the exact grace_period_ends_at we just
                            # wrote above so the email + dashboard banner
                            # show identical dates.
                            grace_end_iso = update.get("grace_period_ends_at")
                            try:
                                grace_end = _dt.fromisoformat(
                                    (grace_end_iso or "").replace("Z", "+00:00")
                                ).strftime("%B %-d, %Y")
                            except Exception:
                                grace_end = (_dt.now(_tz.utc) + _td(days=3)).strftime("%B %-d, %Y")
                            send_reminder_once(
                                m_row["id"], "payment_failed",
                                send_payment_failed_notice,
                                email, m_row.get("business_name") or "", grace_end,
                            )
                    else:
                        print(f"[webhook] {event['type']} merchant={m_row['id']}: no email on file, skip reminder")
            except Exception as mail_exc:
                print(f"[webhook] reminder dispatch failed sub={sub_id}: {mail_exc!r}")

    else:
        print(f"[webhook] Unhandled event: {event['type']}")

    # Idempotency record was written up front via the atomic claim at the
    # top of this handler — nothing to record here.
    print(f"[webhook] ========== WEBHOOK DONE ==========")
    return JSONResponse(content={"received": True}, status_code=200)


# ── Public: Recent Sales Feed ─────────────────────────────────

@router.get("/recent-sales")
async def recent_sales(limit: int = 10):
    """Public endpoint: recent paid/fulfilled orders for social proof.

    REAL STRIPE SALES ONLY. Two filters:

      1. The order must carry a real Stripe identifier — either
         stripe_session_id or stripe_payment_intent_id. This excludes
         every row inserted by backend/db/seeds/demo_businesses.sql
         (Sparkle Pro Mobile Wash, GrowthKit, Date Night Box Co., etc.)
         which were seeded directly into the orders table without
         going through Stripe Checkout. The LiveActivityTicker on the
         homepage was repeating those demo rows in a tight loop and
         making the platform feel fake; this filter is the surgical
         fix at the data-source layer.

      2. The parent project must not be soft-hidden via
         `visibility='hidden'` (migration 029_project_visibility).
         Same intent: hidden founder demos shouldn't surface in the
         ticker even if they somehow have Stripe IDs.

    The frontend (LiveActivityTicker) keeps its REAL_SALES_FLOOR=5
    gate, so the ticker stays hidden entirely until 5 real Stripe
    sales accumulate on the platform — no fake-looking repeat loops.

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
                "stripe_session_id, stripe_payment_intent_id, "
                "offers(title, project_id, projects(title, visibility))"
            )
            .in_("status", ["paid", "fulfilled"])
            .order("created_at", desc=True)
            .limit(db_limit)
            .execute()
        )
        sales = []
        for row in (res.data or []):
            # Real-Stripe-only: skip seed rows that have no Stripe id.
            if not (row.get("stripe_session_id") or row.get("stripe_payment_intent_id")):
                continue
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

    # Verify ownership. Use the canonical 3-strategy match (same shape
    # as ivs._verify_owner and projects.go_live's owner check) so a
    # project whose row has only privy_id set — but no resolved
    # owner_id — still authorizes for its actual owner. The earlier
    # single-strategy check (resolved != owner_id) returned 403 for
    # any project that was created via the privy_id path, which is
    # how the project page silently showed "0 ORDERS" for a merchant
    # who in fact owned 17 rows.
    project_res = (
        supabase.table("projects")
        .select("owner_id, privy_id")
        .eq("id", project_id)
        .limit(1)
        .execute()
    )
    if not project_res.data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_res.data[0]
    resolved = _resolve_privy_to_owner(supabase, privy_id)
    owner_match = (
        (project.get("owner_id") and project["owner_id"] == privy_id)
        or (project.get("owner_id") and resolved and project["owner_id"] == resolved)
        or (project.get("privy_id") and project["privy_id"] == privy_id)
    )
    if not owner_match:
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


# ── Solana wallet checkout ──────────────────────────────────────
#
# Two endpoints, used together by the frontend "Pay with SOL" CTA:
#
#   POST /api/checkout/sol-quote
#     - Buyer-authenticated. Frontend calls this BEFORE asking the
#       wallet to sign. Server quotes lamports for the offer's USD
#       price at the current oracle rate, signs the quote with
#       SOL_CHECKOUT_QUOTE_HMAC_SECRET, and returns it with a 90s
#       expiry. The buyer can't tamper with the quoted lamports.
#
#   POST /api/checkout/sol-confirm
#     - Buyer-authenticated. Frontend calls this AFTER the wallet
#       broadcasts the SystemProgram.transfer. Server verifies the
#       quote (HMAC + expiry + offer + buyer match), dedupes the
#       on-chain signature, verifies the transfer landed in the
#       treasury via Solana RPC, then creates a paid order and
#       runs process_order_paid for the same side-effects as the
#       Stripe webhook (inventory, broadcast, DUM points, emails).
#
# Stripe behaviour is untouched. SOL is opt-in per buyer.

DUM_TREASURY_WALLET = os.getenv("DUM_TREASURY_WALLET", "").strip()
SOL_MIN_USD = 0.50  # match Stripe's $0.50 floor — keeps fee math sane
ALLOWED_SOL_SOURCES = {
    "normal", "live", "live_auction",
    "sol", "live_sol", "live_auction_sol",
}


class SolQuoteRequest(BaseModel):
    offer_id: str
    auction_id: Optional[str] = None
    override_price: Optional[float] = None


class SolConfirmRequest(BaseModel):
    offer_id: str
    quote_id: str
    tx_signature: str
    wallet_address: str
    source: str = "sol"
    auction_id: Optional[str] = None
    notes: Optional[str] = None


def _resolve_seller_for_offer(supabase, offer: dict) -> tuple[str, str]:
    """Return (project_id, seller_user_id) for the given offer.
    Mirrors the resolution logic used by create-payment-intent."""
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
    return project_id, seller_user_id


@router.post("/sol-quote")
async def sol_quote(
    body: SolQuoteRequest,
    current_user: dict = Depends(get_current_user),
):
    """Issue a 90s HMAC-signed SOL price quote for an offer."""
    if not DUM_TREASURY_WALLET:
        raise HTTPException(status_code=503, detail="Treasury wallet not configured")

    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    supabase = get_client()

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

    # Same price-resolution rule as Stripe path: auction override wins.
    if body.override_price is not None and body.auction_id:
        usd_amount = float(body.override_price)
    else:
        usd_amount = float(offer["price_usd"])

    if usd_amount < SOL_MIN_USD:
        raise HTTPException(
            status_code=400,
            detail=f"Price must be at least ${SOL_MIN_USD:.2f} for SOL checkout.",
        )

    lamports, sol_amount = usd_to_lamports(usd_amount)
    if lamports <= 0:
        raise HTTPException(
            status_code=503,
            detail="SOL price oracle unavailable. Try card checkout.",
        )

    try:
        token, expires_at = make_quote_token(
            offer_id=offer["id"],
            buyer_privy_id=privy_id,
            lamports=lamports,
            sol_amount=sol_amount,
            usd_amount=usd_amount,
            treasury=DUM_TREASURY_WALLET,
            auction_id=body.auction_id,
            override_price=body.override_price,
        )
    except QuoteVerifyError as exc:
        # Only fires when SOL_CHECKOUT_QUOTE_HMAC_SECRET is missing.
        raise HTTPException(status_code=503, detail=str(exc))

    print(
        f"[sol-quote] offer={offer['id']} buyer={privy_id} "
        f"usd={usd_amount} lamports={lamports} expires_at={expires_at}"
    )

    return {
        "quote_id": token,
        "sol_amount": sol_amount,
        "lamports": lamports,
        "usd_amount": usd_amount,
        "treasury": DUM_TREASURY_WALLET,
        "expires_at": expires_at,
    }


@router.post("/sol-confirm")
async def sol_confirm(
    body: SolConfirmRequest,
    current_user: dict = Depends(get_current_user),
):
    """Verify a buyer-supplied SOL transfer and finalize the order."""
    if not DUM_TREASURY_WALLET:
        raise HTTPException(status_code=503, detail="Treasury wallet not configured")

    privy_id = current_user.get("sub")
    if not privy_id:
        raise HTTPException(status_code=401, detail="Invalid auth")

    if body.source not in ALLOWED_SOL_SOURCES:
        raise HTTPException(status_code=400, detail=f"Invalid source: {body.source}")

    if not body.tx_signature or len(body.tx_signature) < 20:
        raise HTTPException(status_code=400, detail="Invalid transaction signature")
    if not body.wallet_address or len(body.wallet_address) < 20:
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    # 1. Verify the quote (HMAC + expiry + offer/buyer match).
    try:
        quote = verify_quote_token(
            body.quote_id,
            expected_offer_id=body.offer_id,
            expected_buyer_privy_id=privy_id,
        )
    except QuoteVerifyError as exc:
        msg = str(exc)
        # Expired quotes get a distinct status so the FE can re-fetch.
        status_code = 410 if "expired" in msg.lower() else 400
        raise HTTPException(status_code=status_code, detail=msg)

    lamports = int(quote["lamports"])
    sol_amount = float(quote["sol_amount"])
    usd_amount = float(quote["usd_amount"])

    supabase = get_client()

    # 2. Dedupe on the on-chain signature BEFORE the (paid) RPC call.
    try:
        dup = (
            supabase.table("orders")
            .select("id")
            .eq("solana_tx_signature", body.tx_signature)
            .limit(1)
            .execute()
        )
        if dup.data:
            raise HTTPException(
                status_code=409,
                detail="This transaction has already been processed",
            )
    except HTTPException:
        raise
    except Exception as dup_err:
        # Don't fail the whole checkout if dedupe lookup glitches —
        # the partial unique index on solana_tx_signature is the
        # backstop. Log and continue.
        print(f"[sol-confirm] dedupe lookup error (non-fatal): {dup_err!r}")

    # 3. Look up the offer + resolve seller (same logic as Stripe path).
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
    project_id, seller_user_id = _resolve_seller_for_offer(supabase, offer)

    # 4. Verify on-chain transfer.
    verification = verify_sol_transfer(
        signature=body.tx_signature,
        expected_lamports=lamports,
        treasury=DUM_TREASURY_WALLET,
        expected_sender=body.wallet_address,
    )
    if verification is not True:
        print(f"[sol-confirm] ✗ verify failed sig={body.tx_signature[:12]}…: {verification}")
        raise HTTPException(status_code=400, detail=verification)

    # 4b. Resolve commission rate for AUDIT ONLY on the SOL path.
    #     SOL settlement-to-merchant is out of scope for this commit
    #     (platform_fee_usd stays 0, seller_receives_usd stays the
    #     full usd_amount). The audit columns let future reconciliation
    #     compute what the platform would have skimmed once SOL
    #     settlement lands. If the resolver can't find a rate, log
    #     and proceed without stamping rather than blocking the sale.
    audit_commission_rate: Optional[Decimal] = None
    audit_application_fee_cents: Optional[int] = None
    try:
        audit_commission_rate = resolve_commission_rate(seller_user_id, supabase=supabase)
        sol_amount_cents = int(round(usd_amount * 100))
        audit_application_fee_cents = int(
            (Decimal(sol_amount_cents) * audit_commission_rate).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
    except CommissionRateUnset as exc:
        print(f"[sol-confirm] audit-only resolver failed for seller={seller_user_id}: {exc}. Stamping NULL.")

    # 5. Insert the order in pending_payment, then process_order_paid
    #    flips it to paid and fires the same side-effects as Stripe.
    #    SOL goes to platform treasury; the merchant's USD-equivalent
    #    payout is settled separately (out of scope for this commit).
    order_insert = {
        "offer_id": offer["id"],
        "project_id": project_id,
        "buyer_user_id": privy_id,
        "seller_user_id": seller_user_id,
        "amount_paid_usd": usd_amount,
        "platform_fee_usd": 0,
        "seller_receives_usd": usd_amount,
        "resolved_commission_rate": (
            float(audit_commission_rate) if audit_commission_rate is not None else None
        ),
        "application_fee_amount_cents": audit_application_fee_cents,
        "status": "pending_payment",
        "buyer_email": None,
        "notes": body.notes,
        "token_discount_applied": False,
        "source": body.source,
        "solana_tx_signature": body.tx_signature,
        "solana_lamports": lamports,
        "solana_buyer_wallet": body.wallet_address,
    }
    try:
        order_res = supabase.table("orders").insert(order_insert).execute()
    except Exception as ins_err:
        # Most likely cause: the unique index on solana_tx_signature
        # caught a race we missed at step 2. Treat as duplicate.
        print(f"[sol-confirm] insert error sig={body.tx_signature[:12]}…: {ins_err!r}")
        raise HTTPException(
            status_code=409,
            detail="This transaction has already been processed",
        )

    if not order_res.data:
        raise HTTPException(status_code=500, detail="Failed to create order record")

    order = order_res.data[0]
    print(
        f"[sol-confirm] ✓ order={order['id']} sig={body.tx_signature[:12]}… "
        f"lamports={lamports} sol={sol_amount} usd={usd_amount}"
    )

    process_order_paid(
        supabase,
        order,
        event_id=body.tx_signature,
        source="sol_confirm",
    )

    return {
        "order_id": order["id"],
        "status": "paid",
        "tx_signature": body.tx_signature,
        "sol_amount": sol_amount,
        "lamports": lamports,
        "usd_amount": usd_amount,
    }
