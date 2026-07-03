"use client";

/**
 * SubscriptionStatusBar — persistent trust-signal header for /dashboard.
 *
 * Always renders for any signed-in user with a merchants row. Surfaces
 * what plan they're on, what they're paying, trial status (with end
 * date when known), the 1.5% marketplace fee constant, and Stripe
 * connection state.
 *
 * Four variants, driven by /api/merchant/trial-status:
 *
 *   founder       — grandfathered=true
 *   trial         — subscription_status='trialing'
 *   paid          — subscription_status in {'active','past_due','paused','suspended','cancelled'}
 *   fallback      — endpoint failed / merchant has no row / shape unknown
 *
 * Design constraints (per sprint brief):
 *   - Sits ABOVE the primary action card on /dashboard.
 *   - Compact: single line on desktop, wraps cleanly on mobile.
 *   - Never blocks dashboard rendering (returns the fallback variant
 *     instantly while data loads, then refines once /trial-status
 *     resolves).
 *   - No backend changes — consumes the existing /api/merchant/trial-status
 *     endpoint that TrialCountdownBanner already uses.
 *   - Does NOT render a "Manage Plan" button: no billing-portal route
 *     exists in the codebase yet. The TrialCountdownBanner still owns
 *     the cancel-trial CTA for trial-state action.
 *
 * The status bar and the TrialCountdownBanner are intentionally separate:
 *   - This bar is always-on transparency.
 *   - The countdown banner triggers on action-needed states (paused,
 *     past_due, trial-about-to-end).
 */

import { useEffect, useState } from "react";

import { API_BASE } from "../lib/apiBase";

type Props = {
  /** Privy bearer-token resolver. */
  getToken: () => Promise<string | null | undefined>;
  /** Cached Stripe Connect status from /api/merchant/me (avoids a second
   *  fetch). One of "connected" | "verified" | "pending" | other. */
  stripeConnectStatus?: string | null;
};

type TrialStatus = {
  has_merchant?: boolean;
  grandfathered?: boolean;
  subscription_status?: string | null;
  trial_ends_at?: string | null;
  plan_label?: string | null;
  plan_price_usd?: number | null;
  has_subscription?: boolean;
  is_past_due?: boolean;
  is_suspended?: boolean;
};

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function stripeLabel(status?: string | null): { text: string; ok: boolean } {
  const s = (status || "").toLowerCase();
  if (s === "verified" || s === "connected") return { text: "Stripe Connected ✓", ok: true };
  if (s === "pending" || s === "pending_verification") return { text: "Stripe Pending", ok: false };
  return { text: "Stripe Not Connected", ok: false };
}

export function SubscriptionStatusBar({ getToken, stripeConnectStatus }: Props) {
  const [status, setStatus] = useState<TrialStatus | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          if (!cancelled) setResolved(true);
          return;
        }
        const res = await fetch(`${API_BASE}/api/merchant/trial-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as TrialStatus;
          if (!cancelled) setStatus(data);
        }
      } catch {
        // Soft-fail: fallback variant renders.
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // Pre-resolution: render nothing (avoids layout shift between
  // fallback → real data). Once /trial-status resolves OR token is
  // absent, we render the appropriate variant.
  if (!resolved) return null;

  const stripe = stripeLabel(stripeConnectStatus);

  // ── Variant selection ───────────────────────────────────────
  // Founder: grandfathered=true -> founding pricing locked for life.
  // Doctrine (CLAUDE.md §3): never quote a specific dollar amount as
  // locked - the founding lock is on the TIER, and $0 implied the
  // platform is free forever.
  if (status?.grandfathered) {
    return (
      <div className="mb-6 rounded-2xl border border-brand-teal/40 bg-brand-teal-soft px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-y-1 text-xs font-semibold text-brand-navy sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:text-sm">
          <span className="font-bold text-brand-teal">◆ FOUNDING MERCHANT</span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>Founding pricing locked for life</span>
            <span className="text-secondary">·</span>
            <span>1.5% sales fee</span>
            <span className="text-secondary">·</span>
            <span className={stripe.ok ? "text-brand-teal" : "text-amber-500"}>{stripe.text}</span>
          </div>
        </div>
      </div>
    );
  }

  // No merchant row OR data unavailable → fallback.
  if (!status || !status.has_merchant) {
    return (
      <div className="mb-6 rounded-2xl border border-default bg-surface-card px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-y-1 text-xs font-semibold text-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:text-sm">
          <span>Plan status unavailable</span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>1.5% marketplace fee</span>
            <span>·</span>
            <span className={stripe.ok ? "text-brand-teal" : "text-amber-500"}>{stripe.text}</span>
          </div>
        </div>
      </div>
    );
  }

  const planLabel = (status.plan_label || "").trim() || "Plan";
  const planPrice = typeof status.plan_price_usd === "number" ? `$${status.plan_price_usd}/mo` : "";
  const trialEndsLabel = formatShortDate(status.trial_ends_at);
  const isTrialing = status.subscription_status === "trialing";

  // Trial variant.
  if (isTrialing) {
    return (
      <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-y-1 text-xs font-semibold text-primary sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:text-sm">
          <span className="font-bold text-amber-500">Trial active</span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{planLabel}</span>
            {planPrice && (
              <>
                <span className="text-secondary">·</span>
                <span>{planPrice} after trial</span>
              </>
            )}
            {trialEndsLabel && (
              <>
                <span className="text-secondary">·</span>
                <span className="text-secondary">Trial ends {trialEndsLabel}</span>
              </>
            )}
            <span className="text-secondary">·</span>
            <span>1.5% marketplace fee</span>
            <span className="text-secondary">·</span>
            <span className={stripe.ok ? "text-brand-teal" : "text-amber-500"}>{stripe.text}</span>
          </div>
        </div>
      </div>
    );
  }

  // Paid variant (active / past_due / paused / suspended / cancelled — anything
  // that isn't trial and isn't grandfathered, including unknown statuses).
  return (
    <div className="mb-6 rounded-2xl border border-default bg-surface-card px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-y-1 text-xs font-semibold text-primary sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:text-sm">
        <span className="font-bold">
          {planLabel} {(status.subscription_status || "active").toLowerCase()}
        </span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {planPrice && (
            <>
              <span>{planPrice}</span>
              <span className="text-secondary">·</span>
            </>
          )}
          <span>1.5% marketplace fee</span>
          <span className="text-secondary">·</span>
          <span className={stripe.ok ? "text-brand-teal" : "text-amber-500"}>{stripe.text}</span>
        </div>
      </div>
    </div>
  );
}
