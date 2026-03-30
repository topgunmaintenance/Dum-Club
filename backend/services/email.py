"""
Email notifications for order lifecycle events.
Uses Resend. Fails silently — never blocks the main order flow.
"""
import os

_RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
_FROM_EMAIL = os.getenv("EMAIL_FROM", "DUM Club <orders@dum.club>")
_PLATFORM_URL = os.getenv("NEXT_PUBLIC_SITE_URL", "https://dum-club.vercel.app")


def _send(to: str, subject: str, html: str):
    """Send email via Resend. Never raises — logs errors."""
    if not _RESEND_API_KEY:
        print(f"[email] Skipped (no RESEND_API_KEY): to={to} subject={subject}")
        return
    try:
        import resend
        resend.api_key = _RESEND_API_KEY
        result = resend.Emails.send({
            "from": _FROM_EMAIL,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        print(f"[email] Sent to={to} subject={subject} id={result.get('id', '?')}")
    except Exception as e:
        print(f"[email] FAILED to={to} subject={subject} error={e}")


def send_buyer_payment_confirmed(buyer_email: str, offer_title: str, amount_usd: float, project_name: str = ""):
    """Email buyer after successful payment."""
    if not buyer_email:
        print("[email] No buyer email, skipping buyer confirmation")
        return
    subject = f"Payment confirmed — {offer_title}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">Payment Confirmed</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        Your purchase of <strong style="color:#fff;">{offer_title}</strong> for
        <strong style="color:#4ade80;">${amount_usd:.2f} USD</strong> was successful.
      </p>
      {f'<p style="color:#71717a;font-size:13px;">From: {project_name}</p>' if project_name else ''}
      <p style="color:#71717a;font-size:13px;margin-top:16px;">
        The seller has been notified and will fulfill your order.
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
    subject = f"New sale — {offer_title}"
    html = f"""
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#e4e4e7;border-radius:12px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:#4ade80;margin-bottom:16px;">DUM Club</div>
      <h2 style="color:#fff;margin:0 0 8px;">New Sale!</h2>
      <p style="color:#a1a1aa;font-size:14px;line-height:1.6;">
        Someone purchased <strong style="color:#fff;">{offer_title}</strong> for
        <strong style="color:#4ade80;">${amount_usd:.2f} USD</strong>.
      </p>
      <p style="color:#71717a;font-size:13px;">You receive: ${seller_receives_usd:.2f}</p>
      <a href="{_PLATFORM_URL}/project/{project_id}" style="display:inline-block;margin-top:16px;padding:10px 20px;background:#4ade80;color:#000;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">
        View Sales
      </a>
    </div>
    """
    _send(seller_email, subject, html)


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
