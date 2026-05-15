"use client";

/**
 * StripeResumeBanner — idempotent "Resume Stripe Setup" CTA on
 * /dashboard.
 *
 * Background: Phase 0B is blocked on one real paid Stripe
 * transaction. Every merchant we onboard goes through the Stripe
 * Connect Express OAuth flow exactly once. If they bounce out of
 * Stripe's hosted form before submitting (browser closed, identity
 * doc not handy, Stripe asks for more info later), they come back
 * to /dashboard with stripe_connect_status='connected' or
 * 'pending_verification' — short of 'verified', which is what the
 * checkout / go-live gates require.
 *
 * Today the only way back is to click step 2 of GetLiveSteps,
 * which routes them to /merchant, where they have to find the
 * Connect Stripe button again. This component cuts that step out:
 * if the merchant lands on /dashboard with anything-but-verified,
 * a prominent banner gives them a single click to relaunch
 * Stripe's hosted onboarding.
 *
 * Idempotency: every click hits /api/merchant/stripe-connect/
 * authorize fresh, which builds a brand-new HMAC-signed state
 * token + OAuth URL. Stripe accepts repeated authorize starts on
 * the same connected account and resumes onboarding inline — the
 * merchant lands back on the same Stripe form they bounced out
 * of, with the data they already entered preserved.
 *
 * Hidden states:
 *   - status === 'verified'          — no banner, onboarding done
 *   - status === null (no merchant)  — no banner, signup first
 *
 * Visible states:
 *   - 'not_connected'                — "Connect Stripe to start
 *                                       getting paid"
 *   - 'connected' / 'pending_verification' — "Finish Stripe setup"
 *   - 'restricted'                   — "Stripe restricted your
 *                                       account — resume to resolve"
 */

import { useEffect, useState } from "react";
import { CircleDollarSign, AlertTriangle, ArrowRight } from "lucide-react";

import { API_BASE } from "../lib/apiBase";

type Status =
  | "not_connected"
  | "connected"
  | "pending_verification"
  | "verified"
  | "restricted"
  | null;

type Props = {
  /** Privy token resolver. Hidden behind a function so the banner
   *  doesn't hold a stale token across refreshes. */
  getToken: () => Promise<string | null | undefined>;
};

export function StripeResumeBanner({ getToken }: Props) {
  const [status, setStatus] = useState<Status>(null);
  const [requirementsDue, setRequirementsDue] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [resumeBusy, setResumeBusy] = useState(false);
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
        const res = await fetch(
          `${API_BASE}/api/merchant/stripe-connect/status`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          // 404 -> no merchant row yet -> hide.
          if (!cancelled) {
            setStatus(null);
            setLoading(false);
          }
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        setStatus((json?.status as Status) ?? null);
        const due = Array.isArray(json?.requirements_currently_due)
          ? json.requirements_currently_due.length
          : 0;
        setRequirementsDue(due);
      } catch {
        // Network blip — keep banner hidden rather than surface a
        // confusing error before the merchant has done anything.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  async function startOrResumeStripe() {
    setResumeBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in again to continue.");
        setResumeBusy(false);
        return;
      }
      const res = await fetch(
        `${API_BASE}/api/merchant/stripe-connect/authorize`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        setError(`Stripe authorize failed (${res.status}).`);
        setResumeBusy(false);
        return;
      }
      const json = await res.json();
      if (json?.url) {
        window.location.href = json.url;
        return;
      }
      setError("Stripe did not return an authorize URL.");
    } catch (e) {
      setError("Network error reaching Stripe.");
    }
    setResumeBusy(false);
  }

  // Hidden states.
  if (loading) return null;
  if (status === null) return null;
  if (status === "verified") return null;

  const isRestricted = status === "restricted";
  const isStarted = status === "connected" || status === "pending_verification";

  const headline = isRestricted
    ? "Stripe needs more information"
    : isStarted
    ? "Finish your Stripe setup"
    : "Connect Stripe to start getting paid";

  const body = isRestricted
    ? "Stripe has restricted payouts on your account until you provide the requested information. Click below to resolve it directly in Stripe."
    : isStarted
    ? requirementsDue > 0
      ? `Stripe is waiting on ${requirementsDue} item${
          requirementsDue === 1 ? "" : "s"
        } before you can take live payments. Pick up where you left off.`
      : "You started Stripe onboarding but did not finish. Pick up where you left off to start taking live payments."
    : "Your storefront cannot accept money until Stripe Connect is set up. Takes about three minutes.";

  const cta = isStarted || isRestricted ? "Resume Stripe Setup" : "Connect Stripe";

  return (
    <section
      aria-labelledby="stripe-resume-heading"
      className={`mb-6 rounded-3xl border p-6 shadow-sm sm:p-8 ${
        isRestricted
          ? "border-red-500/30 bg-red-500/[0.04]"
          : "border-amber-500/30 bg-amber-500/[0.04]"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
            isRestricted
              ? "bg-red-500/15 text-red-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
          aria-hidden="true"
        >
          {isRestricted ? (
            <AlertTriangle className="h-5 w-5" strokeWidth={2} />
          ) : (
            <CircleDollarSign className="h-5 w-5" strokeWidth={2} />
          )}
        </span>
        <div className="flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-secondary">
            Phase 0B blocker
          </div>
          <h2
            id="stripe-resume-heading"
            className="mt-1 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl"
          >
            {headline}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            {body}
          </p>
          {error && (
            <p className="mt-3 text-xs font-medium text-red-400">{error}</p>
          )}
          <button
            type="button"
            onClick={startOrResumeStripe}
            disabled={resumeBusy}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover disabled:opacity-50"
          >
            {resumeBusy ? "Opening Stripe..." : cta}
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </section>
  );
}
