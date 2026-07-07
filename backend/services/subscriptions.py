"""
subscriptions — Stripe Subscription management for platform billing.

This module is the platform-billing side of Stripe (recurring SaaS revenue
flowing INTO DUM Club). It is intentionally separate from the merchant-side
Stripe Connect flow in backend/api/routes/merchant.py, which handles payouts
flowing FROM customers TO the merchant's own bank.

Two distinct Stripe object families involved:
  - stripe.Customer (cus_*)    — a DUM Club merchant, paying us
  - stripe.Subscription (sub_*)— their recurring SaaS plan with us
  - stripe.Account (acct_*)    — their own connected account for receiving
                                  customer money (handled in merchant.py)

The trial architecture (checkout-trial, 2026-07-07 — card-upfront):
  - On merchant signup, create_trial_checkout_session() runs:
      stripe.Customer.create(...)
      stripe.checkout.Session.create(
          mode="subscription",
          customer=...,
          line_items=[{ "price": <tier price>, "quantity": 1 }],
          payment_method_collection="always",
          subscription_data={
              "trial_period_days": 30,
              "trial_settings": {
                  "end_behavior": {"missing_payment_method": "cancel"}
              },
          },
      )
  - The merchant enters a card on the Stripe-hosted page BEFORE the
    trial starts (Netflix model). Nothing is charged for 30 days.
  - Stripe creates the Subscription when Checkout completes; the
    checkout.session.completed webhook (purchase_type=merchant_trial)
    links the ids back onto the merchants row.
  - At day 30 minus 14, Stripe fires customer.subscription.trial_will_end —
    we send the D-14 reminder.
  - At trial end Stripe charges the saved card automatically. The
    missing_payment_method=cancel setting is a safety net for the rare
    subscription whose card was detached mid-trial.
  - create_trial_subscription() (no card, direct provisioning) remains
    for the admin per-merchant backfill path only.
  - Grandfathered merchants (founding 100 pre-launch) skip this entirely.

Failure mode: every Stripe call is wrapped in try/except so a Stripe outage
during signup degrades to a free-tier account rather than a 500. The caller
gets None for any field that failed; the dashboard reconciles on next visit.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional, TypedDict

import stripe

from db.supabase import get_client


_STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY")
_STRIPE_PRICE_ID_GROWTH = os.getenv("STRIPE_PRICE_ID_GROWTH")
_STRIPE_PRICE_ID_STARTER = os.getenv("STRIPE_PRICE_ID_STARTER")
_STRIPE_PRICE_ID_PRO = os.getenv("STRIPE_PRICE_ID_PRO")

TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "30"))


class TrialResult(TypedDict, total=False):
    """Return shape of create_trial_subscription. Optional fields are present
    only when the upstream call succeeded."""
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]
    subscription_price_id: Optional[str]
    trial_start_at: Optional[str]
    trial_ends_at: Optional[str]
    next_billing_at: Optional[str]
    subscription_status: Optional[str]
    error: Optional[str]


def _resolve_price_id(tier: str) -> Optional[str]:
    """Map a plan tier label to the configured Stripe Price id.

    Three self-serve tiers: starter, growth (default), pro.

    The "business" tier ($499/mo, white-label loyalty) is intentionally
    NOT handled here. Business is custom-quote — merchants reach Julian
    via the mailto: CTA on /pricing, the contract is negotiated, and
    Stripe Subscription is created manually in the Stripe Dashboard for
    that specific account. The auto-trial signup flow always defaults
    to growth.

    Anything we don't recognise (including "business") falls back to
    growth so a typo on the caller side never crashes signup.
    """
    tier = (tier or "growth").lower()
    if tier == "starter":
        return _STRIPE_PRICE_ID_STARTER
    if tier == "pro":
        return _STRIPE_PRICE_ID_PRO
    return _STRIPE_PRICE_ID_GROWTH


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def create_billing_portal_session(customer_id: str, return_url: str) -> Optional[str]:
    """Stripe-hosted Customer Portal session (billing-portal, 2026-07-06).

    THE card-entry path for DUM Club: merchants add/update their payment
    method on stripe.com, never on our pages — same trust posture as
    Connect onboarding. Requires the portal to be activated once in the
    Stripe dashboard (Settings → Billing → Customer portal); until then
    Session.create raises and we return None so the caller can explain.
    """
    if not _STRIPE_SECRET or not customer_id:
        return None
    stripe.api_key = _STRIPE_SECRET
    try:
        session = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
        )
        return session.url
    except Exception as exc:
        print(f"[subscriptions] portal session failed for {customer_id[-6:]}: {exc!r}")
        return None


def ensure_stripe_customer(privy_id: str, email: Optional[str], business_name: Optional[str]) -> Optional[str]:
    """Create a bare Stripe Customer for a merchant that predates the
    trial code (no stripe_customer_id yet), so the billing portal has
    someone to open for. Returns the customer id or None."""
    if not _STRIPE_SECRET:
        return None
    stripe.api_key = _STRIPE_SECRET
    try:
        customer = stripe.Customer.create(
            email=email or None,
            name=business_name or None,
            metadata={"privy_id": privy_id, "source": "dum-club-billing-portal-backfill"},
            # Same double-click protection as signup (audit finding 7).
            idempotency_key=f"dum-portal-cust-{privy_id}",
        )
        return customer.id
    except Exception as exc:
        print(f"[subscriptions] ensure_customer failed for privy={privy_id[-6:]}: {exc!r}")
        return None


class TrialCheckoutResult(TypedDict, total=False):
    """Return shape of create_trial_checkout_session. Optional fields are
    present only when the upstream call succeeded."""
    checkout_url: Optional[str]
    stripe_customer_id: Optional[str]
    subscription_price_id: Optional[str]
    error: Optional[str]


def create_trial_checkout_session(
    privy_id: str,
    email: Optional[str],
    business_name: Optional[str],
    tier: str,
    merchant_id: str,
    identity_hash: Optional[str],
    success_url: str,
    cancel_url: str,
) -> TrialCheckoutResult:
    """Card-upfront trial signup (checkout-trial, 2026-07-07).

    Creates a Stripe Customer plus a Stripe-hosted Checkout Session that
    collects a payment method BEFORE the 30-day trial starts — the
    Netflix model. Stripe creates the Subscription itself when the
    merchant completes Checkout; the checkout.session.completed webhook
    (metadata purchase_type=merchant_trial) writes the subscription ids
    back onto the merchants row and records the trial-identity ledger.

    Card entry happens on stripe.com — we never touch card data, same
    trust posture as the billing portal and Connect onboarding.

    Returns {checkout_url, stripe_customer_id} on success, {error} on any
    Stripe failure — the caller treats that as "trial not provisioned"
    exactly like the old direct-provisioning path.
    """
    if not _STRIPE_SECRET:
        return {"error": "STRIPE_SECRET_KEY not configured"}

    price_id = _resolve_price_id(tier)
    if not price_id:
        return {"error": f"STRIPE_PRICE_ID_{tier.upper()} not configured"}

    stripe.api_key = _STRIPE_SECRET

    try:
        customer = stripe.Customer.create(
            email=email or None,
            name=business_name or None,
            metadata={
                "privy_id": privy_id,
                "source": "dum-club-merchant-signup",
            },
            # Same salted idempotency as the legacy path (audit finding 7):
            # double-clicks dedupe, a corrected config gets a fresh attempt.
            idempotency_key=f"dum-cust-{privy_id}-{price_id}-{(email or 'noemail')[:24]}",
        )
    except Exception as exc:
        print(f"[subscriptions] Customer.create failed for privy={privy_id[-6:]}: {exc!r}")
        return {"error": f"customer_create_failed: {type(exc).__name__}: {str(exc)[:160]}"}

    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer.id,
            line_items=[{"price": price_id, "quantity": 1}],
            # The whole point of the checkout-trial flow: no free trial
            # without a card on file.
            payment_method_collection="always",
            subscription_data={
                "trial_period_days": TRIAL_DAYS,
                "trial_settings": {
                    "end_behavior": {"missing_payment_method": "cancel"},
                },
                "metadata": {
                    "privy_id": privy_id,
                    "merchant_id": merchant_id,
                    "source": "dum-club-merchant-signup",
                },
            },
            metadata={
                "purchase_type": "merchant_trial",
                "privy_id": privy_id,
                "merchant_id": merchant_id,
                "tier": tier,
                "price_id": price_id,
                # Ledger write happens in the webhook, once the trial is
                # actually granted — not at session creation, where an
                # abandoned checkout would burn the identity's only trial.
                "identity_hash": identity_hash or "",
            },
            success_url=success_url,
            cancel_url=cancel_url,
        )
    except Exception as exc:
        print(f"[subscriptions] Checkout Session.create failed for privy={privy_id[-6:]}: {exc!r}")
        return {"error": f"checkout_session_create_failed: {type(exc).__name__}: {str(exc)[:160]}"}

    return {
        "checkout_url": session.url,
        "stripe_customer_id": customer.id,
        "subscription_price_id": price_id,
    }


def create_trial_subscription(
    privy_id: str,
    email: Optional[str],
    business_name: Optional[str],
    tier: str = "growth",
) -> TrialResult:
    """
    Create a Stripe Customer + Subscription with a TRIAL_DAYS (default 30)
    trial for this merchant — WITHOUT card collection. Since the
    checkout-trial flow (2026-07-07) this is no longer the signup path;
    it remains only for the admin per-merchant backfill
    (POST /api/admin/merchants/{id}/start-trial), where the operator
    deliberately grants a no-card trial.

    Returns a TrialResult with the Stripe ids + computed timestamps. On any
    Stripe failure, returns a TrialResult with only the error field set; the
    caller must treat this as "trial not provisioned" and surface a retry path
    in the dashboard.

    Idempotency: the caller is responsible for not invoking this twice for the
    same merchant. The merchants row's stripe_subscription_id column is the
    guard — if it's already populated, skip.
    """
    if not _STRIPE_SECRET:
        return {"error": "STRIPE_SECRET_KEY not configured"}

    price_id = _resolve_price_id(tier)
    if not price_id:
        return {"error": f"STRIPE_PRICE_ID_{tier.upper()} not configured"}

    stripe.api_key = _STRIPE_SECRET

    try:
        customer = stripe.Customer.create(
            email=email or None,
            name=business_name or None,
            metadata={
                "privy_id": privy_id,
                "source": "dum-club-merchant-signup",
            },
            # Audit finding 7 (2026-07-07): double-clicks / retries raced
            # past the DB guard and minted duplicate Stripe objects. The
            # key is salted with price + email so a CORRECTED config gets
            # a fresh attempt (fix/trial-retry 2026-07-07: the unsalted
            # key replayed a customer the failure path had DELETED,
            # bricking retries for 24h) while true double-clicks — same
            # params within seconds — still dedupe.
            idempotency_key=f"dum-cust-{privy_id}-{price_id}-{(email or 'noemail')[:24]}",
        )
    except Exception as exc:
        print(f"[subscriptions] Customer.create failed for privy={privy_id[-6:]}: {exc!r}")
        return {"error": f"customer_create_failed: {type(exc).__name__}: {str(exc)[:160]}"}

    try:
        subscription = stripe.Subscription.create(
            customer=customer.id,
            items=[{"price": price_id}],
            # Salted like the customer key — a fixed price ID must get a
            # fresh attempt, not a 24h replay of the old failure.
            idempotency_key=f"dum-trial-{privy_id}-{price_id}",
            trial_period_days=TRIAL_DAYS,
            trial_settings={
                "end_behavior": {"missing_payment_method": "pause"},
            },
            payment_behavior="default_incomplete",
            payment_settings={
                "save_default_payment_method": "on_subscription",
            },
            expand=["latest_invoice.payment_intent"],
            metadata={
                "privy_id": privy_id,
                "source": "dum-club-merchant-signup",
            },
        )
    except Exception as exc:
        print(f"[subscriptions] Subscription.create failed for privy={privy_id[-6:]}: {exc!r}")
        # DO NOT delete the customer (fix/trial-retry 2026-07-07). The old
        # delete-on-failure cleanup, combined with idempotent customer
        # creation, replayed a DELETED customer id on retry and bricked
        # trial provisioning for 24h. An idle customer row costs nothing,
        # is reused by the salted idempotency key on the next attempt,
        # and is visible in Stripe if manual cleanup is ever wanted.
        # Surface Stripe's actual message so the admin banner says WHY
        # (e.g. "No such price", "not a recurring price") instead of the
        # bare exception class.
        return {"error": f"subscription_create_failed: {type(exc).__name__}: {str(exc)[:160]}"}

    trial_start = datetime.fromtimestamp(subscription.trial_start, tz=timezone.utc) if subscription.get("trial_start") else datetime.now(timezone.utc)
    trial_end = datetime.fromtimestamp(subscription.trial_end, tz=timezone.utc) if subscription.get("trial_end") else None
    next_billing = (
        datetime.fromtimestamp(subscription.current_period_end, tz=timezone.utc)
        if subscription.get("current_period_end") else trial_end
    )

    return {
        "stripe_customer_id": customer.id,
        "stripe_subscription_id": subscription.id,
        "subscription_price_id": price_id,
        "trial_start_at": _iso(trial_start),
        "trial_ends_at": _iso(trial_end) if trial_end else None,
        "next_billing_at": _iso(next_billing) if next_billing else None,
        "subscription_status": subscription.status,
    }


def cancel_subscription(stripe_subscription_id: str) -> bool:
    """
    Cancel a Stripe Subscription immediately. Called from
    POST /api/merchant/cancel-trial when the merchant decides during the trial
    not to continue. Returns True on success.
    """
    if not _STRIPE_SECRET or not stripe_subscription_id:
        return False
    stripe.api_key = _STRIPE_SECRET
    try:
        stripe.Subscription.delete(stripe_subscription_id)
        return True
    except Exception as exc:
        print(f"[subscriptions] cancel failed sub={stripe_subscription_id}: {exc!r}")
        return False


def update_merchant_from_subscription(stripe_subscription_id: str) -> None:
    """
    Refresh the merchants row's denormalised subscription fields from Stripe.
    Called from the webhook handlers in checkout.py whenever a
    customer.subscription.* event arrives, so the dashboard countdown stays
    accurate without polling.
    """
    if not _STRIPE_SECRET or not stripe_subscription_id:
        return
    stripe.api_key = _STRIPE_SECRET

    try:
        sub = stripe.Subscription.retrieve(stripe_subscription_id)
    except Exception as exc:
        print(f"[subscriptions] retrieve failed sub={stripe_subscription_id}: {exc!r}")
        return

    update: dict = {"subscription_status": sub.status}
    if sub.get("trial_end"):
        update["trial_ends_at"] = _iso(datetime.fromtimestamp(sub.trial_end, tz=timezone.utc))
    if sub.get("current_period_end"):
        update["next_billing_at"] = _iso(datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc))

    try:
        sb = get_client()
        sb.table("merchants").update(update).eq(
            "stripe_subscription_id", stripe_subscription_id
        ).execute()
    except Exception as exc:
        print(f"[subscriptions] DB write-through failed sub={stripe_subscription_id}: {exc!r}")
