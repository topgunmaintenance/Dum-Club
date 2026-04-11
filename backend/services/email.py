"""
Email notifications for order lifecycle events.
Uses Resend. Fails non-fatally — never blocks the main order flow.

Every send is logged and reports back a bool so callers can detect
config-disabled state if they need to. A module-level startup log makes
the enabled state visible in Railway logs without tailing per-request.
"""
import os

_RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
_FROM_EMAIL = os.getenv("EMAIL_FROM", "DUM Club <orders@dum.club>")
_PLATFORM_URL = os.getenv("NEXT_PUBLIC_SITE_URL", "https://dum-club.vercel.app")

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
