"use client";

/**
 * TrialCountdownBanner — 60-day free-trial countdown on /dashboard.
 *
 * Renders nothing for:
 *   - signed-out users (no token)
 *   - merchants without a row (no signup yet)
 *   - grandfathered founding merchants (no auto-billing)
 *   - merchants without a Stripe Subscription provisioned (legacy/error state)
 *   - cancelled subscriptions
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

  if (loading) return null;
  if (!status) return null;
  if (!status.has_merchant) return null;
  if (status.grandfathered) return null;
  if (!status.has_subscription) return null;

  const isCancelled = status.subscription_status === "cancelled";
  const isPastDue = status.subscription_status === "past_due";
  const isPaused = status.subscription_status === "paused";
  const isTrialing = status.subscription_status === "trialing";
  const daysLeft = status.days_remaining;

  if (isCancelled) return null;

  const danger = isPastDue || isPaused;
  const headline = isPastDue
    ? "Your payment did not go through"
    : isPaused
    ? "Your plan is paused"
    : isTrialing && daysLeft !== null && daysLeft > 0
    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in your free trial`
    : "Your free trial is up";

  const planPrice = status.plan_price_usd ? `$${status.plan_price_usd}/month` : "your plan";
  const planLabel = status.plan_label ? ` ${status.plan_label}` : "";
  const startDate = formatDate(status.next_billing_at);

  const body = isPastDue
    ? "We could not charge your card. Add or update a payment method in Stripe to keep your plan active."
    : isPaused
    ? "Add a payment method in Stripe to resume your plan and keep selling."
    : isTrialing && daysLeft !== null && daysLeft > 0 && startDate
    ? `Your${planLabel} plan at ${planPrice} starts on ${startDate}. No charge until then. You can cancel any time.`
    : `Your${planLabel} plan at ${planPrice} starts now.`;

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
            Free trial
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
