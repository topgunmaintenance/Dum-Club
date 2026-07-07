"use client";

/**
 * TrialCountdownBanner — 30-day free-trial countdown on /dashboard.
 *
 * Renders nothing for:
 *   - signed-out users (no token)
 *   - merchants without a row (no signup yet)
 *   - grandfathered founding merchants (no auto-billing)
 *   - cancelled subscriptions
 *
 * Merchants without a Stripe Subscription (abandoned Checkout, or a
 * Stripe outage during signup) get a "start your free trial" state
 * instead of silence: a CTA that POSTs /api/merchant/trial-checkout and
 * sends them to the Stripe-hosted page to put a card on file
 * (checkout-trial, 2026-07-07).
 *
 * Otherwise shows a plain-English line:
 *   "47 days left in your free trial. Your $49/month Growth plan starts on
 *    July 13, 2026."
 *
 * The banner is intentionally calm — amber tone for "active trial", red for
 * paused / past_due. No pressure tactics; the merchant should feel informed,
 * not chased.
 *
 * Cancel-before-billing CTA links to a small inline confirm that POSTs to
 * /api/merchant/cancel-trial. Stripe takes care of the rest.
 */

import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";

import { API_BASE } from "../lib/apiBase";

type Props = {
  /** Privy token resolver. */
  getToken: () => Promise<string | null | undefined>;
};

type TrialStatus = {
  has_merchant: boolean;
  grandfathered: boolean;
  subscription_status: string | null;
  trial_ends_at: string | null;
  days_remaining: number | null;
  next_billing_at: string | null;
  plan_label: string | null;
  plan_price_usd: number | null;
  has_subscription: boolean;
  // Phase 2: grace period + suspension fields. Optional so older
  // backend versions returning the pre-grace shape still hydrate.
  grace_period_starts_at?: string | null;
  grace_period_ends_at?: string | null;
  grace_days_remaining?: number | null;
  is_past_due?: boolean;
  is_suspended?: boolean;
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function TrialCountdownBanner({ getToken }: Props) {
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await fetch(`${API_BASE}/api/merchant/trial-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const json = (await res.json()) as TrialStatus;
        if (!cancelled) setStatus(json);
      } catch {
        // Network blip — keep the banner hidden rather than scare the
        // merchant with an error before they've done anything.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in again to continue.");
        setCancelling(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/merchant/cancel-trial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError(`Could not cancel (${res.status}).`);
        setCancelling(false);
        return;
      }
      const json = await res.json();
      if (json.cancelled) {
        setStatus((s) =>
          s ? { ...s, subscription_status: "cancelled" } : s,
        );
        setConfirmingCancel(false);
      } else {
        setError("Nothing to cancel.");
      }
    } catch {
      setError("Network error.");
    }
    setCancelling(false);
  }

  async function handleStartCheckout() {
    setStartingCheckout(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in again to continue.");
        setStartingCheckout(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/merchant/trial-checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || `Could not start checkout (${res.status}).`);
        setStartingCheckout(false);
        return;
      }
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setError("Could not start checkout. Try again in a moment.");
    } catch {
      setError("Network error.");
    }
    setStartingCheckout(false);
  }

  if (loading) return null;
  if (!status) return null;
  if (!status.has_merchant) return null;
  if (status.grandfathered) return null;

  if (!status.has_subscription) {
    // Signed up but never finished the Stripe Checkout (or Stripe was
    // down during signup). Give them the path back in.
    return (
      <section
        aria-labelledby="trial-countdown-heading"
        className="mb-6 rounded-3xl border border-amber-500/30 bg-amber-500/[0.04] p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-start gap-4">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400"
            aria-hidden="true"
          >
            <Clock className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-secondary">
              Free trial
            </div>
            <h2
              id="trial-countdown-heading"
              className="mt-1 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl"
            >
              Start your 30-day free trial
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-secondary">
              Put a card on file to start your free trial. Nothing is charged
              today, and you can cancel any time during the trial.
            </p>
            {error && (
              <p className="mt-3 text-xs font-medium text-red-400">{error}</p>
            )}
            <button
              type="button"
              onClick={handleStartCheckout}
              disabled={startingCheckout}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover disabled:opacity-50"
            >
              {startingCheckout ? "Opening Stripe..." : "Start my free trial →"}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const isCancelled = status.subscription_status === "cancelled";
  const isSuspended = status.is_suspended === true || status.subscription_status === "suspended";
  const isPastDue = !isSuspended && (status.is_past_due === true || status.subscription_status === "past_due");
  const isPaused = status.subscription_status === "paused";
  const isTrialing = status.subscription_status === "trialing";
  const daysLeft = status.days_remaining;
  const graceEndDate = formatDate(status.grace_period_ends_at ?? null);

  if (isCancelled) return null;

  const danger = isSuspended || isPastDue || isPaused;
  // Plain-English copy — never surface the raw status words "past_due" or
  // "suspended" to the merchant. The banner colour + tone signal urgency;
  // the copy gives them the next action.
  const headline = isSuspended
    ? "Your shop is paused"
    : isPastDue
    ? "Your payment didn't go through"
    : isPaused
    ? "Your plan is paused"
    : isTrialing && daysLeft !== null && daysLeft > 0
    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial`
    : "Your free trial is up";

  const planPrice = status.plan_price_usd ? `$${status.plan_price_usd}/month` : "your plan";
  const planLabel = status.plan_label ? ` ${status.plan_label}` : "";
  const startDate = formatDate(status.next_billing_at);

  const body = isSuspended
    ? "Going live and new orders are off until you update your payment method. Everything else still works so you can come back any time."
    : isPastDue && graceEndDate
    ? `Your payment didn't go through. Update your card by ${graceEndDate} to keep your shop active. No charges until the card is fixed.`
    : isPastDue
    ? "Your payment didn't go through. Update your payment method to keep your shop active."
    : isPaused
    ? "Add a payment method to resume your plan and keep selling."
    : isTrialing && daysLeft !== null && daysLeft > 0 && startDate
    ? `Your${planLabel} plan at ${planPrice} starts on ${startDate}. No charge until then. You can cancel any time.`
    : `Your${planLabel} plan at ${planPrice} starts now.`;

  // Action CTA for the payment-failed and suspended states. Routes to the
  // existing Stripe Connect resume path, which is where merchants manage
  // their payment method via Stripe's hosted form.
  const showUpdatePaymentCTA = isSuspended || isPastDue || isPaused;

  return (
    <section
      aria-labelledby="trial-countdown-heading"
      className={`mb-6 rounded-3xl border p-6 shadow-sm sm:p-8 ${
        danger
          ? "border-red-500/30 bg-red-500/[0.04]"
          : "border-amber-500/30 bg-amber-500/[0.04]"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            danger
              ? "bg-red-500/15 text-red-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
          aria-hidden="true"
        >
          {danger ? (
            <AlertTriangle className="h-5 w-5" strokeWidth={2} />
          ) : (
            <Clock className="h-5 w-5" strokeWidth={2} />
          )}
        </span>
        <div className="flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-secondary">
            {showUpdatePaymentCTA ? "Payment" : "Free trial"}
          </div>
          <h2
            id="trial-countdown-heading"
            className="mt-1 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl"
          >
            {headline}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">{body}</p>
          {error && (
            <p className="mt-3 text-xs font-medium text-red-400">{error}</p>
          )}
          {showUpdatePaymentCTA && (
            <a
              href="/merchant"
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover"
            >
              Update Payment Method →
            </a>
          )}
          {isTrialing && !confirmingCancel && (
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="mt-4 text-xs font-medium text-secondary underline-offset-4 transition hover:text-primary hover:underline"
            >
              Cancel before billing
            </button>
          )}
          {isTrialing && confirmingCancel && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-xs text-secondary">
                Cancel your trial now? No charges, ever.
              </span>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex items-center rounded-xl bg-brand-teal px-4 py-2 text-xs font-bold text-brand-navy transition hover:bg-brand-teal-hover disabled:opacity-50"
              >
                {cancelling ? "Cancelling..." : "Cancel my trial"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                className="text-xs text-secondary hover:text-primary"
              >
                Keep my trial
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
