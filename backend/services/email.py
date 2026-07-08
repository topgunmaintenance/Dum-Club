"""
Email notifications for order lifecycle events.
Uses Resend. Fails non-fatally — never blocks the main order flow.

Every send is logged and reports back a bool so callers can detect
config-disabled state if they need to. A module-level startup log makes
the enabled state visible in Railway logs without tailing per-request.
"""
import hashlib
import hmac
import os
import urllib.parse

_RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
_FROM_EMAIL = os.getenv("EMAIL_FROM", "DUM Club <orders@dum.club>")
_PLATFORM_URL = os.getenv("NEXT_PUBLIC_SITE_URL", "https://dum.club")
# Used specifically by the outreach unsubscribe link. Kept separate from
# _PLATFORM_URL so we can route the unsubscribe click through the
# known-good FRONTEND_URL env var even if NEXT_PUBLIC_SITE_URL on Railway
# is stale (e.g. still pointing at a Vercel preview subdomain). The two
# env vars can converge once NEXT_PUBLIC_SITE_URL is cleaned up.
_FRONTEND_URL = os.getenv("FRONTEND_URL", "https://dum.club")

# Secret used to sign unsubscribe links for outreach emails. Falls back
# to a deterministic default so the feature works out of the box; set
# a real value in Railway env for production to prevent unsubscribe-
# token forging.
_OUTREACH_UNSUB_SECRET = os.getenv(
    "OUTREACH_UNSUBSCRIBE_SECRET",
    "dumclub-outreach-default-secret-change-me",
)
if _OUTREACH_UNSUB_SECRET == "dumclub-outreach-default-secret-change-me":
    print("[email] WARNING: OUTREACH_UNSUBSCRIBE_SECRET is not set — using default. "
          "Set a real value in Railway env before production outreach.")

# EMAIL_ENABLED is the canonical "do we have a key?" flag. Read by the
# readiness helper and by the /api/health/email endpoint. Not a secret.
EMAIL_ENABLED: bool = bool(_RESEND_API_KEY)

# Surface the startup state in logs so ops can see "email off" in Railway
# without tailing per-request. One line, grep-friendly, no noise.
if EMAIL_ENABLED:
    print(f"[email] startup: Resend enabled, from={_FROM_EMAIL}")
else:
    print("[email] startup: RESEND_API_KEY is not set — email delivery DISABLED until it is")


def get_email_status() -> dict:
    """
    Read-only status snapshot for admin/system health. Not a secret.
    Fields:
        enabled:      True when a real send will be attempted
        provider:     always "resend" in this build
        key_set:      whether RESEND_API_KEY is present
        from_address: the configured EMAIL_FROM value (public)
    """
    return {
        "enabled": EMAIL_ENABLED,
        "provider": "resend",
        "key_set": bool(_RESEND_API_KEY),
        "from_address": _FROM_EMAIL,
    }


def _send(to: str, subject: str, html: str) -> bool:
    """
    Send email via Resend. Never raises — logs errors. Returns True when
    a real send was attempted (regardless of downstream success), False
    when skipped due to missing config. Existing callers that ignore the
    return value continue to work unchanged.
    """
    if not _RESEND_API_KEY:
        print(f"[email] skipped (disabled: no RESEND_API_KEY) to={to} subject={subject!r}")
        return False
    try:
        import resend
        resend.api_key = _RESEND_API_KEY
        result = resend.Emails.send({
            "from": _FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        print(f"[email] sent to={to} subject={subject!r} id={result.get('id', '?')}")
        return True
    except Exception as e:
        print(f"[email] FAILED to={to} subject={subject!r} err={type(e).__name__}: {e}")
        return True  # send was attempted — config is fine, provider failed


def send_buyer_payment_confirmed(buyer_email: str, offer_title: str, amount_usd: float, project_name: str = ""):
    """Email buyer after successful payment. Doctrine-compliant copy:
    DUM Points framed as discount-redeemable loyalty rewards only, no
    investment / token / on-chain language (CLAUDE.md §5, §12 Rule 3).
    """
    if not buyer_email:
        print("[email] No buyer email, skipping buyer confirmation")
        return
    subject = f"Purchase confirmed + you earned DUM Points"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">Purchase Confirmed ✓</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        You purchased <strong style="color:#fff;">{offer_title}</strong> for
        <strong style="color:#4ade80;">${amount_usd:.2f} USD</strong>.
      </p>
      {f'<p style="color:#71717a;font-size:13px;">From: {project_name}</p>' if project_name else ''}
      <div style="margin:16px 0;padding:16px;background:#052e16;border:1px solid #166534;border-radius:8px;">
        <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 4px;">You earned DUM Points</p>
        <p style="color:#86efac;font-size:13px;margin:0;">
          Loyalty rewards you can redeem for discounts at any DUM Club business. Earn at one shop, spend at another.
        </p>
      </div>
      <a href="{_PLATFORM_URL}/orders" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View your orders
      </a>
    </div>
    """
    _send(buyer_email, subject, html)


def send_seller_new_order(seller_email: str, offer_title: str, amount_usd: float, seller_receives_usd: float, project_id: str):
    """Email seller when a new order comes in."""
    if not seller_email:
        print("[email] No seller email, skipping seller notification")
        return
    subject = f"You made a sale 🔥 {offer_title}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">New Sale! 🔥</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        Someone purchased <strong style="color:#fff;">{offer_title}</strong> for
        <strong style="color:#4ade80;">${amount_usd:.2f} USD</strong>.
      </p>
      <p style="color:#71717a;font-size:13px;">You receive: <strong style="color:#fff;">${seller_receives_usd:.2f}</strong></p>
      <p style="color:#52525b;font-size:12px;margin-top:12px;">Your live store is working. Keep selling.</p>
      <a href="{_PLATFORM_URL}/project/{project_id}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View Sales
      </a>
    </div>
    """
    _send(seller_email, subject, html)


def send_dum_reward_email(buyer_email: str, dum_earned: int, total_balance: int, offer_title: str):
    """Email buyer about DUM Points earned from a purchase. Doctrine-
    compliant copy: discount-redeemable loyalty rewards only, no
    token / on-chain / investment framing (CLAUDE.md §5, §12 Rule 3).
    1 DUM Point = $0.10 in discount value (CLAUDE.md §5)."""
    if not buyer_email:
        return
    subject = f"You earned {dum_earned} DUM Points"
    # 1 DUM Point = $0.10 (CLAUDE.md §5). Render the redeemable
    # dollar value so the buyer sees the discount they actually get.
    balance_value_usd = total_balance * 0.10
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club Rewards</div>
      <h2 style="color:#fff;margin:0 0 8px;">+{dum_earned} DUM Points earned</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        Your purchase of <strong style="color:#fff;">{offer_title}</strong> earned you
        <strong style="color:#4ade80;">{dum_earned} DUM Points</strong>.
      </p>
      <div style="margin:16px 0;padding:16px;background:#052e16;border:1px solid #166534;border-radius:8px;text-align:center;">
        <p style="color:#4ade80;font-size:28px;font-weight:800;margin:0;">{total_balance} Points</p>
        <p style="color:#86efac;font-size:12px;margin:4px 0 0;">Worth ${balance_value_usd:.2f} in discounts at participating merchants</p>
      </div>
      <p style="color:#52525b;font-size:12px;line-height:1.5;">
        DUM Points are loyalty rewards. Redeem them for discounts at any DUM Club business. Earn at one shop, spend at another.
      </p>
      <a href="{_PLATFORM_URL}/hub" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View your Points
      </a>
    </div>
    """
    _send(buyer_email, subject, html)


def send_buyer_fulfilled(buyer_email: str, offer_title: str):
    """Email buyer when seller marks order as fulfilled."""
    if not buyer_email:
        print("[email] No buyer email, skipping fulfillment notification")
        return
    subject = f"Order fulfilled: {offer_title}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">Order Fulfilled</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        Your order for <strong style="color:#fff;">{offer_title}</strong> has been fulfilled by the seller.
      </p>
      <a href="{_PLATFORM_URL}/orders" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View Your Orders
      </a>
    </div>
    """
    _send(buyer_email, subject, html)


def send_guest_reply_notification(
    guest_email: str,
    business_name: str,
    reply_text: str,
    storefront_url: str = "",
):
    """Email a guest when the merchant replies to their storefront message,
    so the conversation can thread back over email. Best-effort: no-op when
    guest_email is missing. Body text is escaped by the caller path (plain
    merchant prose); we inset it into a simple template."""
    if not guest_email:
        print("[email] No guest email, skipping guest reply notification")
        return
    safe_name = business_name or "The merchant"
    subject = f"{safe_name} replied to your message"
    link = storefront_url or _PLATFORM_URL
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">{safe_name} replied</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;white-space:pre-wrap;">{reply_text}</p>
      <a href="{link}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        Reply on their storefront
      </a>
    </div>
    """
    _send(guest_email, subject, html)


# ══════════════════════════════════════════════════════════════════
# MERCHANT OUTREACH
# ══════════════════════════════════════════════════════════════════
#
# Proactive cold outreach to merchants not yet on DUM Club. Templates
# are rendered against the lead's business_name. Every email includes
# a signed unsubscribe link as required for CAN-SPAM compliance and
# to protect Resend sender reputation — DO NOT remove.
#
# send_outreach_email() returns a (send_ok, error_message) tuple so
# the caller can persist the result alongside the message audit row.


def unsubscribe_token(contact: str) -> str:
    """HMAC-SHA256 token bound to a lowercased contact. Short-enough for
    URL use, still infeasible to guess. Stable across restarts as long
    as OUTREACH_UNSUBSCRIBE_SECRET is stable."""
    return hmac.new(
        _OUTREACH_UNSUB_SECRET.encode("utf-8"),
        contact.strip().lower().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


def verify_unsubscribe_token(contact: str, token: str) -> bool:
    """Constant-time comparison against the expected token."""
    expected = unsubscribe_token(contact)
    return hmac.compare_digest(expected, token or "")


def _unsubscribe_url(contact: str) -> str:
    """Build the one-click unsubscribe link embedded in every outreach
    email. Lands on the /api/outreach/unsubscribe public endpoint.

    Uses _FRONTEND_URL (from FRONTEND_URL env var) rather than
    _PLATFORM_URL so the unsubscribe link routes through the known-good
    domain configured on Railway even if NEXT_PUBLIC_SITE_URL is stale.
    """
    token = unsubscribe_token(contact)
    qs = urllib.parse.urlencode({"contact": contact, "token": token})
    return f"{_FRONTEND_URL}/api/outreach/unsubscribe?{qs}"


# Template registry. Keyed by template_key stored on outreach_messages.
# Each template is a dict with subject + plain body text. HTML is
# rendered by _render_outreach_html below.
OUTREACH_TEMPLATES: dict = {
    "initial": {
        "subject": "We already built your store",
        "body": (
            "Hi {business_name},\n\n"
            "How much are you losing in fees every month?\n\n"
            "We built DUM Club, a platform where you pay a flat monthly "
            "subscription plus just a 1.5% sales fee per order. Whatnot takes "
            "8% per sale; DoorDash takes 15-30%. DUM Club is industry-low, "
            "with customer loyalty rewards built in automatically.\n\n"
            "We already set up a store page for you. Want access?\n\n"
            "Every business gets 30 days free. Sell live from your own "
            "website. Your customers see you, ask questions, and buy on "
            "the spot.\n\n"
            "Check what we built for you:\n"
            "{cta_url}\n\n"
            "— Julian\n"
            "DUM Club"
        ),
    },
    "followup_day2": {
        "subject": "Quick follow-up on your DUM Club store",
        "body": (
            "Hi {business_name},\n\n"
            "Just circling back on your DUM Club store. Two days ago I "
            "mentioned we already set one up for you, ready when you "
            "are.\n\n"
            "30 days free, cancel any time during the trial. After that "
            "it's a flat subscription plus a 1.5% sales fee per order "
            "(Whatnot takes 8%). Want a look?\n\n"
            "Check what we built for you:\n"
            "{cta_url}\n\n"
            "— Julian\n"
            "DUM Club"
        ),
    },
    "followup_day5": {
        "subject": "Your store is still waiting",
        "body": (
            "Hi {business_name},\n\n"
            "Your DUM Club store is still sitting there ready. People "
            "shop local because of the person behind the counter. Live "
            "selling puts you back in front of them, right on your own "
            "site.\n\n"
            "Takes 60 seconds to have a look.\n\n"
            "Check what we built for you:\n"
            "{cta_url}\n\n"
            "— Julian\n"
            "DUM Club"
        ),
    },
    "followup_day10": {
        "subject": "Last ping on your DUM Club store",
        "body": (
            "Hi {business_name},\n\n"
            "Last note from me on this. Your store is still there if "
            "you want it, but I don't want to keep pinging if this "
            "isn't a fit. No offence taken either way.\n\n"
            "If you'd like to see the store we built for you:\n"
            "{cta_url}\n\n"
            "Otherwise I'll leave you alone.\n\n"
            "— Julian\n"
            "DUM Club"
        ),
    },
}

# Ordered (longest-first) so the follow-up endpoint picks the highest
# applicable template based on days since last_contacted_at.
OUTREACH_FOLLOWUP_SEQUENCE = [
    # (min_days_since_last_contact, template_key)
    (10, "followup_day10"),
    (5,  "followup_day5"),
    (2,  "followup_day2"),
]


def _render_outreach_html(body_text: str, contact: str) -> str:
    """Wrap a plain-text outreach body in a minimal premium email layout
    with the mandatory unsubscribe link at the bottom."""
    unsub_url = _unsubscribe_url(contact)
    body_html = body_text.replace("\n\n", "</p><p style=\"margin:12px 0;\">").replace("\n", "<br/>")
    return f"""
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <div style="color:#e4e4e7;font-size:14px;line-height:1.6;">
        <p style="margin:12px 0;">{body_html}</p>
      </div>
      <hr style="border:none;border-top:1px solid #27272a;margin:28px 0 16px;" />
      <p style="color:#52525b;font-size:11px;line-height:1.5;margin:0;">
        You're receiving this because DUM Club reached out about bringing your business onto the platform.
        Don't want these? <a href="{unsub_url}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a>.
      </p>
    </div>
    """


def render_outreach_template(template_key: str, business_name, contact: str):
    """Return (subject, plain_body, html_body) for a given template + lead.

    Raises KeyError if the template key is unknown.
    """
    tpl = OUTREACH_TEMPLATES[template_key]
    # Business name may be null — fall back to a friendly default.
    name = (business_name or "there").strip() if business_name else "there"
    cta_url = f"{_PLATFORM_URL}/merchant"
    plain_body = tpl["body"].format(business_name=name, cta_url=cta_url)
    html_body = _render_outreach_html(plain_body, contact)
    return tpl["subject"], plain_body, html_body


def send_outreach_email(contact: str, subject: str, html_body: str):
    """Send a merchant outreach email. Never raises.

    Returns (send_ok, error_message). On provider failure send_ok is
    False and error_message contains the exception repr so the caller
    can persist it on outreach_messages.send_error for later debugging.

    If EMAIL is disabled (no RESEND_API_KEY), returns
    (False, "email service disabled").
    """
    if not _RESEND_API_KEY:
        return False, "email service disabled"
    try:
        import resend
        resend.api_key = _RESEND_API_KEY
        result = resend.Emails.send({
            "from": _FROM_EMAIL,
            "to": [contact],
            "subject": subject,
            "html": html_body,
        })
        print(f"[email] outreach sent to={contact} subject={subject!r} id={result.get('id', '?')}")
        return True, None
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[email] outreach FAILED to={contact} subject={subject!r} err={err}")
        return False, err


# ────────────────────────────────────────────────────────────
# Trial reminder emails
# ────────────────────────────────────────────────────────────
# Five plain-English templates fired from the daily reminder cron
# (T-14, T-7, T-1) and from the Stripe webhook handler (conversion
# confirmation, payment failure). Every call is one-shot per merchant
# per reminder_type — idempotency is enforced by the
# trial_reminder_log table's UNIQUE (merchant_id, reminder_type).
#
# Calling code is responsible for:
#   1. Inserting into trial_reminder_log FIRST
#   2. If the insert succeeds, calling the send function below
#   3. If the unique-constraint blew up, skipping silently (already sent)
#
# This module exposes the send fns + the trial_reminder_html helper.
# All copy is short, declarative, no jargon.


def _trial_reminder_html(
    headline: str,
    body_paragraphs: list[str],
    cta_label: str | None = None,
    cta_href: str | None = None,
) -> str:
    """Shared HTML shell so every trial email looks the same. Plain and
    direct — a 4th-grader can read it. The same shell is used for the
    countdown emails, conversion confirmation, and the payment-failed
    notice. Caller picks the headline + body + optional CTA."""
    para_html = "\n".join(
        f'<p style="color:#444;font-size:15px;line-height:1.65;margin:0 0 14px;">{p}</p>'
        for p in body_paragraphs
    )
    cta_html = ""
    if cta_label and cta_href:
        cta_html = (
            f'<a href="{cta_href}" style="display:inline-block;margin-top:8px;'
            f'padding:12px 22px;background:#00FFA3;color:#000;text-decoration:none;'
            f'border-radius:10px;font-size:14px;font-weight:700;">{cta_label}</a>'
        )
    return f"""
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff;color:#111;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#00A36F;margin-bottom:14px;">DUM Club</div>
      <h2 style="color:#111;margin:0 0 14px;font-size:22px;line-height:1.25;">{headline}</h2>
      {para_html}
      {cta_html}
      <p style="color:#888;font-size:12px;line-height:1.5;margin-top:28px;">
        DUM Club helps businesses sell live on their own website and keep every sale.
      </p>
    </div>
    """


def send_trial_t_minus_14(merchant_email: str, business_name: str, plan_price_usd: int, trial_end_date: str) -> bool:
    """Sent 14 days before trial_ends_at."""
    if not merchant_email:
        return False
    subject = "Your free trial ends in 2 weeks"
    html = _trial_reminder_html(
        headline=f"Hey {business_name or 'there'}, two weeks left in your free trial",
        body_paragraphs=[
            f"Your 30-day free trial of DUM Club ends on <strong>{trial_end_date}</strong>.",
            f"After that, your plan will be <strong>${plan_price_usd}/month</strong> plus a 1.5% sales fee per order (industry-low; Whatnot takes 8%).",
            "Your card on file starts then, so there's nothing to set up. Not ready? Cancel any time before that date with one click and you won't be charged.",
        ],
        cta_label="Open my dashboard",
        cta_href=f"{_PLATFORM_URL}/dashboard",
    )
    return _send(merchant_email, subject, html)


def send_trial_t_minus_7(merchant_email: str, business_name: str, plan_price_usd: int, trial_end_date: str) -> bool:
    """Sent 7 days before trial_ends_at."""
    if not merchant_email:
        return False
    subject = "1 week left in your free trial"
    html = _trial_reminder_html(
        headline="One week to go",
        body_paragraphs=[
            f"Your free trial ends on <strong>{trial_end_date}</strong>.",
            f"Add a payment method to keep going at <strong>${plan_price_usd}/month</strong>. You can cancel any time before then with one click.",
        ],
        cta_label="Open my dashboard",
        cta_href=f"{_PLATFORM_URL}/dashboard",
    )
    return _send(merchant_email, subject, html)


def send_trial_t_minus_1(merchant_email: str, business_name: str, plan_price_usd: int, trial_end_date: str) -> bool:
    """Sent 1 day before trial_ends_at."""
    if not merchant_email:
        return False
    subject = "Your trial ends tomorrow. Payment starts in 24 hours"
    html = _trial_reminder_html(
        headline="Your trial ends tomorrow",
        body_paragraphs=[
            f"Tomorrow ({trial_end_date}), your free trial ends.",
            f"Your card on file will be charged and your <strong>${plan_price_usd}/month</strong> plan starts. Not ready? Cancel with one click before then and you won't be charged.",
        ],
        cta_label="Manage my plan",
        cta_href=f"{_PLATFORM_URL}/dashboard",
    )
    return _send(merchant_email, subject, html)


def send_trial_conversion_confirmed(merchant_email: str, business_name: str, plan_price_usd: int) -> bool:
    """Sent on first invoice.paid after the trial ends."""
    if not merchant_email:
        return False
    subject = f"You're in. Your {business_name or 'DUM Club'} plan is now active."
    html = _trial_reminder_html(
        headline="You're in. Plan is active.",
        body_paragraphs=[
            f"Your free trial is over and your <strong>${plan_price_usd}/month</strong> plan is now running.",
            "1.5% sales fee per paid order, deducted from your Stripe payout (industry-low; Whatnot takes 8%). Money still goes straight to your bank.",
            "Thanks for building with us.",
        ],
        cta_label="Open my dashboard",
        cta_href=f"{_PLATFORM_URL}/dashboard",
    )
    return _send(merchant_email, subject, html)


def send_payment_failed_notice(merchant_email: str, business_name: str, grace_end_date: str) -> bool:
    """Sent on invoice.payment_failed. Tells the merchant they have a
    grace window to fix the card before the plan pauses."""
    if not merchant_email:
        return False
    subject = "Your payment didn't go through"
    html = _trial_reminder_html(
        headline="Your card didn't go through",
        body_paragraphs=[
            "We tried to charge your card and it didn't go through.",
            f"Update your payment method by <strong>{grace_end_date}</strong> to keep your shop running. If we can't get a payment by then, your plan will pause.",
            "No charge happens automatically until the card is fixed.",
        ],
        cta_label="Update payment method",
        cta_href=f"{_PLATFORM_URL}/dashboard",
    )
    return _send(merchant_email, subject, html)


_LEGAL_SUFFIXES = {"llc": "LLC", "llp": "LLP", "inc": "Inc", "ltd": "Ltd", "co": "Co", "corp": "Corp"}


def _display_business_name(raw: str) -> str:
    """Tidy a business name for display: capitalize all-lowercase words and
    uppercase legal suffixes (llc -> LLC), leaving already-cased brand words
    (iPhone, McName) untouched. Cosmetic best-effort for merchant-facing email
    so a stored "topgun maintenance llc" reads "Topgun Maintenance LLC"."""
    out = []
    for w in raw.split():
        low = w.lower()
        if low in _LEGAL_SUFFIXES:
            out.append(_LEGAL_SUFFIXES[low])
        elif w == low:  # entirely lowercase -> capitalize
            out.append(w.capitalize())
        else:  # already has caps (brand / mixed) -> leave as-is
            out.append(w)
    return " ".join(out)


def send_weekly_merchant_recap(
    merchant_email: str,
    business_name: str,
    week_label: str,
    lives_count: int,
    viewer_hours: float,
    sales_count: int,
    gmv_usd: float,
    top_offer_title: str | None,
    next_live_label: str | None,
) -> bool:
    """Friendly, plain-English weekly recap fired every Monday morning
    by the merchant_recap cron. Copy is short and encouraging — no
    SaaS jargon, no enterprise language. Skips when the merchant
    had zero activity AND nothing scheduled (the cron filters this
    case out, but the helper stays defensive).

    business_name      — human-readable merchant name for the subject + body
    week_label         — pre-formatted "May 19-25" range string
    lives_count        — number of streams started last week
    viewer_hours       — total viewer-hours last week, rounded to .1
    sales_count        — number of paid orders last week
    gmv_usd            — sum of paid order amounts last week
    top_offer_title    — best-selling offer title, or None if no sales
    next_live_label    — pre-formatted "Tuesday at 5:00 PM UTC" string
                          for the next scheduled_live_at, or None
    """
    if not merchant_email:
        return False
    raw_name = (business_name or "").strip()
    name = _display_business_name(raw_name) if raw_name else "there"
    subject = f"Your week on DUM Club ({week_label})"

    # Build the bullet list of last week's numbers. Each row is opt-in
    # depending on whether it has data — we never render "$0.00 in sales"
    # which feels punishing for a slow week.
    lines: list[str] = []
    if lives_count > 0:
        plural = "live" if lives_count == 1 else "lives"
        lines.append(f"<strong>{lives_count}</strong> {plural} last week")
    if viewer_hours > 0:
        lines.append(
            f"<strong>{viewer_hours:.1f}</strong> viewer-hour"
            f"{'s' if viewer_hours != 1 else ''} of attention"
        )
    if sales_count > 0:
        plural = "sale" if sales_count == 1 else "sales"
        lines.append(
            f"<strong>{sales_count}</strong> {plural} totaling "
            f"<strong>${gmv_usd:,.2f}</strong>"
        )
    if top_offer_title:
        lines.append(
            f"Top offer: <strong>{top_offer_title}</strong>"
        )
    if next_live_label:
        lines.append(
            f"Next live: <strong>{next_live_label}</strong>"
        )

    if not lines:
        # Defensive — cron should have filtered, but if a caller
        # invokes this with nothing to say we still return cleanly.
        return False

    bullet_html = "".join(
        f'<li style="margin:8px 0;color:#333;font-size:15px;line-height:1.55;">{line}</li>'
        for line in lines
    )

    # Encouraging close — different copy for "had a great week" vs
    # "had a slow week" so the email never feels tone-deaf.
    if sales_count > 0:
        close = (
            "Nice work. Keep the weekly rhythm going. Customers who "
            "tap Remind me come back on their own."
        )
    elif lives_count > 0:
        close = (
            "Lives are how customers find you. Pin an offer and "
            "schedule next week's slot in one tap."
        )
    elif next_live_label:
        close = (
            "Your next live is on the books. Share the link with "
            "your regulars to fill the room."
        )
    else:
        close = (
            "Pick a slot for next week. We'll email the customers "
            "who asked to be reminded."
        )

    html = f"""
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#fff;color:#111;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#00A36F;margin-bottom:14px;">DUM Club · Weekly Recap</div>
      <h2 style="color:#111;margin:0 0 6px;font-size:22px;line-height:1.25;">{name}</h2>
      <p style="color:#666;font-size:13px;margin:0 0 18px;">Your week on DUM Club ({week_label})</p>
      <ul style="list-style:disc;padding-left:20px;margin:0 0 22px;">
        {bullet_html}
      </ul>
      <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 20px;">{close}</p>
      <a href="{_PLATFORM_URL}/dashboard"
         style="display:inline-block;padding:12px 22px;background:#00FFA3;color:#000;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">
        Open your dashboard
      </a>
      <p style="color:#888;font-size:12px;line-height:1.5;margin-top:28px;">
        Flat monthly subscription plus a 1.5% sales fee. Industry-low.
        DUM Club helps local businesses sell direct and keep every customer.
      </p>
    </div>
    """
    return _send(merchant_email, subject, html)


def send_live_reminder(
    customer_email: str,
    business_name: str,
    project_slug_or_id: str,
    scheduled_for_label: str,
) -> bool:
    """Sent to a customer who subscribed to the storefront's "Remind me
    when live" form. Fires from the live_reminders cron worker.

    business_name      — human-readable merchant name for the subject.
    project_slug_or_id — used for the storefront link.
    scheduled_for_label— pre-formatted local-friendly time string
                          ("Tuesday at 5:00 PM"), supplied by the worker.
    """
    if not customer_email:
        return False
    subject = f"{business_name} is going live now"
    storefront_url = f"{_PLATFORM_URL}/project/{project_slug_or_id}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">{business_name} is going live</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        You asked us to remind you when <strong style="color:#fff;">{business_name}</strong> went live. The show is starting around <strong style="color:#fff;">{scheduled_for_label}</strong>.
      </p>
      <div style="margin:24px 0;text-align:center;">
        <a href="{storefront_url}"
           style="display:inline-block;padding:14px 28px;background:#4ade80;color:#052e16;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
          Watch now &rarr;
        </a>
      </div>
      <p style="color:#71717a;font-size:12px;line-height:1.5;margin-top:24px;">
        You're only on this reminder list for this one show. We won't send anything else from this signup.
      </p>
    </div>
    """
    return _send(customer_email, subject, html)
