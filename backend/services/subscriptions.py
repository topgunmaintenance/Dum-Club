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

The trial architecture (from the pre-launch audit, Option A):
  - On merchant signup, create_trial_subscription() runs:
      stripe.Customer.create(...)
      stripe.Subscription.create(
          customer=...,
          items=[{ "price": STRIPE_PRICE_ID_GROWTH }],
          trial_period_days=60,
          trial_settings={
              "end_behavior": {"missing_payment_method": "pause"}
          },
          payment_behavior="default_incomplete",
      )
  - No card required at signup. Stripe holds the timer.
  - At day 60 minus 14, Stripe fires customer.subscription.trial_will_end —
    we send the D-14 reminder.
  - At trial end, if the merchant has added a payment method, Stripe charges
    automatically. If not, Stripe pauses the subscription and fires
    customer.subscription.updated with status='paused'.
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

TRIAL_DAYS = int(os.getenv("TRIAL_DAYS", "60"))


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


def create_trial_subscription(
    privy_id: str,
    email: Optional[str],
    business_name: Optional[str],
    tier: str = "growth",
) -> TrialResult:
    """
    Create a Stripe Customer + Subscription with a 60-day trial for this
    merchant. Designed to be called once, on /api/merchant/signup, after the
    merchants row has been inserted.

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
        )
    except Exception as exc:
        print(f"[subscriptions] Customer.create failed for privy={privy_id[-6:]}: {exc!r}")
        return {"error": f"customer_create_failed: {type(exc).__name__}"}

    try:
        subscription = stripe.Subscription.create(
            customer=customer.id,
            items=[{"price": price_id}],
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
        # Best-effort cleanup of the orphan Customer so we don't leak rows in
        # Stripe. Failure here is non-fatal — Stripe support can clean up.
        try:
            stripe.Customer.delete(customer.id)
        except Exception:
            pass
        return {"error": f"subscription_create_failed: {type(exc).__name__}"}

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
