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
    """Email buyer after successful payment — includes DUM reward messaging."""
    if not buyer_email:
        print("[email] No buyer email, skipping buyer confirmation")
        return
    subject = f"You bought on Dum Club 🚀 + You earned DUM"
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
        <p style="color:#4ade80;font-size:16px;font-weight:700;margin:0 0 4px;">You earned DUM rewards!</p>
        <p style="color:#86efac;font-size:13px;margin:0;">
          Every purchase on DUM Club earns you DUM. As DUM Club grows, these rewards become more valuable.
        </p>
      </div>
      <p style="color:#52525b;font-size:12px;line-height:1.5;margin-top:12px;">
        DUM will power discounts, boosts, and future on-chain utility on Solana. Keep earning.
      </p>
      <a href="{_PLATFORM_URL}/orders" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View Your Orders
      </a>
    </div>
    """
    _send(buyer_email, subject, html)


def send_seller_new_order(seller_email: str, offer_title: str, amount_usd: float, seller_receives_usd: float, project_id: str):
    """Email seller when a new order comes in."""
    if not seller_email:
        print("[email] No seller email, skipping seller notification")
        return
    subject = f"You made a sale 🔥 — {offer_title}"
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
    """Email buyer about DUM rewards earned from purchase."""
    if not buyer_email:
        return
    subject = f"You earned {dum_earned} DUM 🎉"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club Rewards</div>
      <h2 style="color:#fff;margin:0 0 8px;">+{dum_earned} DUM Earned! 🎉</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        Your purchase of <strong style="color:#fff;">{offer_title}</strong> earned you
        <strong style="color:#4ade80;">{dum_earned} DUM</strong>.
      </p>
      <div style="margin:16px 0;padding:16px;background:#052e16;border:1px solid #166534;border-radius:8px;text-align:center;">
        <p style="color:#4ade80;font-size:28px;font-weight:800;margin:0;">{total_balance} DUM</p>
        <p style="color:#86efac;font-size:12px;margin:4px 0 0;">Your total balance</p>
      </div>
      <p style="color:#52525b;font-size:12px;line-height:1.5;">
        DUM will evolve into a Solana-based token powering discounts, rewards, and commerce on DUM Club.
        Every purchase grows your stake in the platform.
      </p>
      <a href="{_PLATFORM_URL}/hub" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View Your DUM
      </a>
    </div>
    """
    _send(buyer_email, subject, html)


def send_buyer_fulfilled(buyer_email: str, offer_title: str):
    """Email buyer when seller marks order as fulfilled."""
    if not buyer_email:
        print("[email] No buyer email, skipping fulfillment notification")
        return
    subject = f"Order fulfilled — {offer_title}"
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
            "We built DUM Club — a platform where you keep 100% of your "
            "revenue and get built-in customer loyalty rewards automatically.\n\n"
            "We already set up a store page for you. Want access?\n\n"
            "We're onboarding our first 100 founding merchants — free "
            "forever, no commission, no catch. Spots are filling fast.\n\n"
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
            "mentioned we already set one up for you — free forever as a "
            "founding merchant.\n\n"
            "No credit card, no commission, no catch. Want a look?\n\n"
            "Check what we built for you:\n"
            "{cta_url}\n\n"
            "— Julian\n"
            "DUM Club"
        ),
    },
    "followup_day5": {
        "subject": "Still saving your founding spot",
        "body": (
            "Hi {business_name},\n\n"
            "Your founding-merchant spot is still open. Once the 100 "
            "founding slots are filled, the plan shifts to the standard "
            "tier — but founding members are free forever.\n\n"
            "Takes 60 seconds to claim.\n\n"
            "Check what we built for you:\n"
            "{cta_url}\n\n"
            "— Julian\n"
            "DUM Club"
        ),
    },
    "followup_day10": {
        "subject": "Last ping — your DUM Club store",
        "body": (
            "Hi {business_name},\n\n"
            "Last note from me on this. Your founding spot is still "
            "available but I don't want to keep pinging if this isn't a "
            "fit. No offence taken either way.\n\n"
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
