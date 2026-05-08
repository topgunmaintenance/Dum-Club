"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { API_BASE } from "../../lib/apiBase";

type Merchant = {
  id: string;
  business_name: string;
  business_type: string | null;
  location_city: string | null;
  location_state: string | null;
  founding_merchant: boolean;
  subscription_tier: string;
  subscription_price_usd: number;
  stripe_connect_id: string | null;
  stripe_connect_status: string;
  created_at: string;
};

type FoundingStatus = {
  founding_slots_remaining: number;
  total_cap: number;
  founding_program_open: boolean;
};

type StripeStatus = {
  status: "not_connected" | "pending_verification" | "verified" | "restricted";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_currently_due: string[];
  requirements_eventually_due: string[];
  disabled_reason: string | null;
  stripe_connect_id: string | null;
};

// Standard plan price is pulled from an env var so the UI does not
// hard-code $29 anywhere (CLAUDE.md Section 7 rule). Falls back to 29
// only when NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD is unset at build time.
const STANDARD_PLAN_PRICE_USD = Number(
  process.env.NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD ?? 29
);

export default function MerchantPage() {
  const { user, getToken, login } = useAuth();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);

  // Founding program status — pulled from a public endpoint, no auth needed.
  const [foundingStatus, setFoundingStatus] = useState<FoundingStatus | null>(null);

  // Signup form
  const [bizName, setBizName] = useState("");
  const [bizType, setBizType] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Analytics from existing business profile
  const [analytics, setAnalytics] = useState<any>(null);

  // First project (for the "Add DUM Live to your website" deep-link).
  // The merchant audit Phase 3 added a 4th checklist step that deep-
  // links into the Activate-DUM-Live wizard on the merchant's
  // project page. If no project exists yet, the link falls back to
  // /dashboard so the merchant creates one first. We only need id
  // + slug; ignore the rest of the project payload.
  const [firstProject, setFirstProject] = useState<{ id: string; slug: string | null } | null>(null);

  // Live Stripe Connect verification — fetched from
  // /api/merchant/stripe-connect/status which does a fresh
  // Stripe.Account.retrieve and writes the resolved status back to
  // the merchants row. The shape includes charges/payouts/details
  // booleans and the requirements lists Stripe surfaces during
  // onboarding. `null` while loading; `error` if the backend's
  // Stripe.Account.retrieve fails (typically a key/account mismatch
  // — most often surfaces while live OAuth is still being set up).
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [stripeStatusError, setStripeStatusError] = useState<string | null>(null);

  // Stripe Connect return banner. Set from `?stripe=connected` or
  // `?stripe=error&reason=<code>` which the /merchant/stripe-callback
  // page redirects here with. We clean the URL after reading so a
  // refresh doesn't re-trigger the banner.
  const [stripeBanner, setStripeBanner] = useState<
    | { kind: "success" }
    | { kind: "error"; reason: string; detail: string | null }
    | null
  >(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const status = sp.get("stripe");
    if (!status) return;

    if (status === "connected") {
      setStripeBanner({ kind: "success" });
    } else if (status === "error") {
      setStripeBanner({
        kind: "error",
        reason: sp.get("reason") || "unknown",
        detail: sp.get("code"),
      });
    }

    // Strip the stripe-related params from the URL without a reload.
    sp.delete("stripe");
    sp.delete("reason");
    sp.delete("code");
    const clean = sp.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${clean ? `?${clean}` : ""}`,
    );
  }, []);

  useEffect(() => {
    // Founding-status is public — fetch on mount regardless of auth so
    // unauthenticated visitors see the counter on the signup form too.
    fetch(`${API_BASE}/api/merchant/founding-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setFoundingStatus(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadMerchant();
  }, [user]);

  async function loadMerchant() {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/merchant/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.merchant) {
          setMerchant(data.merchant);
          loadAnalytics(token!);
          loadFirstProject();
          if (data.merchant.stripe_connect_id) {
            loadStripeStatus(token!);
          }
        } else {
          setShowSignup(true);
        }
      }
    } catch {}
    setLoading(false);
  }

  async function loadFirstProject() {
    // No auth header needed — /api/projects/ accepts owner_id as a
    // public filter. We only care about (id, slug) so a thrown
    // request or a missing field is non-fatal: firstProject stays
    // null and the checklist falls back to a "create your storefront
    // first" path via /dashboard.
    if (!user?.privyId) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const list = (data?.projects ?? data ?? []) as Array<{
        id?: string;
        slug?: string | null;
      }>;
      const first = list.find((p) => !!p?.id);
      if (first?.id) {
        setFirstProject({ id: first.id, slug: first.slug ?? null });
      }
    } catch {
      // non-fatal — checklist still renders, just lands on /dashboard
    }
  }

  async function loadStripeStatus(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/merchant/stripe-connect/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: StripeStatus = await res.json();
        setStripeStatus(data);
        setStripeStatusError(null);
        // Keep the merchant row's cached status field aligned with
        // what the live endpoint just returned. Avoids a stale
        // "connected" rendering downstream while the page is open.
        setMerchant((m) => (m ? { ...m, stripe_connect_status: data.status } : m));
      } else {
        const detail = await res.json().catch(() => ({}));
        setStripeStatusError(
          typeof detail.detail === "string" ? detail.detail : `HTTP ${res.status}`,
        );
      }
    } catch (err) {
      setStripeStatusError(err instanceof Error ? err.message : "Network error");
    }
  }

  async function loadAnalytics(token: string) {
    try {
      const res = await fetch(`${API_BASE}/api/business/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setAnalytics(await res.json());
    } catch {}
  }

  async function handleSignup() {
    if (!bizName.trim()) { setError("Business name required"); return; }
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/merchant/signup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_name: bizName.trim(),
          business_type: bizType.trim() || null,
          location_city: city.trim() || null,
          location_state: state.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setMerchant(data.merchant);
        setShowSignup(false);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || "Signup failed");
      }
    } catch {
      setError("Network error");
    }
    setSaving(false);
  }

  async function connectStripe() {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/merchant/stripe-connect/authorize`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      }
    } catch {}
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="text-sm text-zinc-500">Loading...</span>
      </div>
    );
  }

  if (!user) {
    // CRITICAL FIX: pre-fix this screen had no sign-in button at all —
    // every "Claim Your Free Spot" homepage click from a logged-out
    // visitor hit a dead end. Now renders a proper sign-in CTA that
    // kicks the Privy login flow, plus the founding-100 scarcity hook
    // so we continue selling while they authenticate.
    const programOpen = foundingStatus?.founding_program_open ?? true;
    const slotsRemaining = foundingStatus?.founding_slots_remaining ?? null;
    const totalCap = foundingStatus?.total_cap ?? 100;
    const claimed = slotsRemaining !== null ? totalCap - slotsRemaining : null;

    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 pt-24">
        <div className="w-full max-w-md text-center">
          {programOpen && claimed !== null && (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-4 py-1.5 shadow-[0_0_24px_rgba(0,255,163,0.15)]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                {claimed} of {totalCap} founding spots claimed
              </span>
            </div>
          )}

          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Keep 100% of every sale.{" "}
            <span className="text-emerald-400">Forever.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-base font-medium text-zinc-200">
            Founding 100 merchants pay $0 today and lock in $29/month forever. Always 0% commission. No credit card.
          </p>

          <button
            onClick={() => login()}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-emerald-400 px-8 text-[13px] font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_24px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.4)]"
          >
            Sign In to Continue →
          </button>

          <p className="mx-auto mt-4 max-w-sm text-[12px] leading-relaxed text-zinc-400">
            After sign-in: enter your business name (one field). Done in 60 seconds. No card, no commission.
          </p>
          <p className="mt-2 text-[11px] text-zinc-500">
            Sign in with email or Google · Takes 30 seconds
          </p>
        </div>
      </div>
    );
  }

  // ── Signup form ──
  if (showSignup) {
    const programOpen = foundingStatus?.founding_program_open ?? true;
    const slotsRemaining = foundingStatus?.founding_slots_remaining ?? null;
    const totalCap = foundingStatus?.total_cap ?? 100;
    const claimed = slotsRemaining !== null ? totalCap - slotsRemaining : null;

    return (
      <div className="min-h-screen bg-zinc-950 pt-24 px-4 pb-16">
        <div className="mx-auto max-w-2xl">

          {/* ── HERO ──
               Continues the homepage pitch instead of dropping a form
               in a void. Scarcity pill matches homepage framing
               ("claimed" not "remaining" — progress/social-proof). */}
          {programOpen && claimed !== null && (
            <div className="mb-6 flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-4 py-1.5 shadow-[0_0_24px_rgba(0,255,163,0.15)]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                  {claimed} of {totalCap} founding spots claimed
                </span>
              </div>
            </div>
          )}

          <div className="mb-8 text-center">
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl">
              Keep{" "}
              <span className="text-emerald-400" style={{ textShadow: "0 0 30px rgba(0,255,163,0.3)" }}>
                100% of every sale.
              </span>{" "}
              Forever.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-base font-medium leading-relaxed text-zinc-200">
              {programOpen
                ? "Founding 100 merchants pay $0 today and lock in $29/month forever. Always 0% commission. No credit card."
                : `Standard plan $${STANDARD_PLAN_PRICE_USD}/month. 0% commission, loyalty rewards built in. No card today.`}
            </p>
          </div>

          {/* ── The form — one field only ──
               Dropped from 4 fields to 1. Rule of thumb: each extra
               field on a cold signup CTA costs ~10% completion. Biz
               type + city + state move to progressive profile after
               signup. Phase 4 of the merchant audit moved the form
               above the 5-expense-line comparison, the 3-point sell,
               and the founder testimonial — on a 393px-wide phone
               the input was previously ~2.5 screens of scroll below
               the H1, costing visible mobile abandonment. The proof
               / sell content sits below the form for hesitant
               readers; merchants who already know they want in see
               the form immediately. */}
          <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-6 shadow-[0_0_32px_rgba(0,255,163,0.08)] sm:p-8">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              {programOpen ? "Claim your founding spot" : "Start a merchant account"}
            </div>
            <h2 className="mb-5 text-2xl font-extrabold text-white">
              {programOpen ? "60 seconds. No card." : `$${STANDARD_PLAN_PRICE_USD}/mo. Cancel anytime.`}
            </h2>

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Business Name</label>
                <input
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSignup(); }}
                  placeholder="e.g. Topgun Maintenance LLC"
                  autoFocus
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-base text-white placeholder-zinc-600 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>
              <button
                onClick={handleSignup}
                disabled={saving || !bizName.trim()}
                className="w-full rounded-xl bg-emerald-400 py-4 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_24px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Claiming your spot..."
                  : programOpen
                  ? "Claim My Founding Spot — $0 Today →"
                  : "Create Merchant Account →"}
              </button>
              <p className="text-center text-[11px] text-zinc-500">
                You can add business type, location, and offers on the next step.
              </p>
            </div>
          </div>

          {/* ── One-fee-replaces-five comparison ──
               Phase 4 of the merchant audit replaced the prior
               Whatnot-only contrast box with the same 5-expense-line
               framing used on the homepage. A barber, restaurant
               owner, mechanic, gym, contractor, or local shop has
               typically NEVER used Whatnot — leading the signup
               with "you'd save vs Whatnot" alienates the very
               audience this page is meant to convert. The five
               expense lines below are the bills a normal local
               business already pays today. */}
          <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.04] to-zinc-900/60 p-5 sm:p-6">
            <div className="mb-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/80">
                One flat fee instead of five
              </div>
              <div className="mt-2 text-base font-bold text-white">
                DUM Club replaces five expense lines you already pay.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { name: "Delivery apps", fees: "15–30%", detail: "of every order" },
                { name: "Live selling", fees: "8% + fees", detail: "per sale" },
                { name: "Loyalty software", fees: "$50–$300", detail: "per month" },
                { name: "SMS retention", fees: "$20–$200", detail: "per month" },
              ].map((p) => (
                <div
                  key={p.name}
                  className="rounded-xl border border-red-500/15 bg-zinc-950/60 p-3 text-center"
                >
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                    {p.name}
                  </div>
                  <div className="mt-1 font-mono text-base font-extrabold text-red-400/80">
                    {p.fees}
                  </div>
                  <div className="text-[10px] text-zinc-500">{p.detail}</div>
                </div>
              ))}
              <div className="col-span-2 rounded-xl border-2 border-emerald-400/50 bg-gradient-to-b from-emerald-400/[0.10] to-zinc-900/60 p-3 text-center shadow-[0_0_24px_rgba(0,255,163,0.15)]">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400">
                  DUM Club
                </div>
                <div className="mt-1 font-mono text-base font-extrabold text-emerald-400">
                  $29–$99
                </div>
                <div className="text-[10px] text-emerald-400/80">
                  flat / month · 0% commission
                </div>
              </div>
            </div>
            <div className="mt-4 text-center text-xs text-zinc-300">
              One bill. <span className="font-bold text-emerald-400">Keep your revenue.</span>
            </div>
          </div>

          {/* ── 3-point sell ── */}
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
            <ul className="space-y-3">
              {[
                "Keep 100% of every sale — 0% commission, always",
                "Customers earn DUM Points on every purchase — loyalty rewards they redeem at any DUM Club business, so they come back without you paying for ads",
                "Founding 100 merchants pay $0 today and lock in $29/month forever",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-sm font-medium leading-relaxed text-zinc-100"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-bold text-emerald-400">
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Founder testimonial — social proof, real face ── */}
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/30 p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <img
                src="/Julian.jpeg"
                alt="Julian Mero — founder, Topgun Maintenance LLC"
                className="h-12 w-12 shrink-0 rounded-full border border-emerald-400/25 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-zinc-200">
                  &ldquo;I&apos;ve run my maintenance business for years. DUM Club is the first platform that doesn&apos;t take a cut of every job. Flat fee, 0% commission — it just works.&rdquo;
                </p>
                <div className="mt-3 text-[11px] text-zinc-500">
                  <span className="font-bold text-white">Julian Mero</span> · Founder · Topgun Maintenance LLC · Founding Merchant #1
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Merchant dashboard ──
  if (!merchant) return null;

  const qrUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/business/${merchant.id}`;

  // ── Onboarding progress ──
  // A merchant who just signed up has an account + a founding spot. They
  // have NOT yet: connected Stripe (required to get paid), and made
  // their first sale. Surface those as a checklist at the very top of
  // the dashboard so "what's my next step?" is never ambiguous.
  //
  // stepStripe is true the moment OAuth completes — i.e. as soon as a
  // stripe_connect_id is on the row. The cached stripe_connect_status
  // string drifts through "connected" → "pending_verification" →
  // "verified" as Stripe's verification progresses, but the checklist
  // is asking "did you connect Stripe?", not "did Stripe verify you?".
  // Verification state is surfaced separately by the Stripe
  // Verification card below.
  const stepAccount = true;
  const stepStripe = !!merchant.stripe_connect_id;
  // Step 3 — "Add DUM Live to your website" — has no direct
  // signal we can read (we don't have a server-side "embed
  // installed" flag, and even if we did, "merchant pasted the
  // snippet on a page we never see" can't be verified
  // remotely). A confirmed first sale proves the install
  // works end-to-end, so we use that as the completion proxy.
  // Until then, the step shows as the active next-action with
  // a deep-link CTA.
  const stepFirstSale = (analytics?.total_orders ?? 0) > 0;
  const stepInstall = stepFirstSale;
  const completedSteps = [stepAccount, stepStripe, stepInstall, stepFirstSale].filter(Boolean).length;
  const totalSteps = 4;
  const onboardingComplete = completedSteps === totalSteps;
  // Where the "Add DUM Live to your website" CTA sends the
  // merchant. If they have at least one project, deep-link
  // straight to that project's page (the Activate-DUM-Live
  // card lives there). Otherwise route to /dashboard so they
  // create a project first.
  const installLink = firstProject
    ? `/project/${firstProject.slug || firstProject.id}`
    : "/dashboard";

  // Human-readable copy for each Stripe-callback failure reason.
  // Keep error codes stable; map to friendly text only at render time.
  const stripeErrorCopy = (reason: string, detail: string | null): string => {
    switch (reason) {
      case "missing_code":
        return "Stripe didn't return an authorization code. Please try connecting again.";
      case "missing_state":
        return "The secure connection token was lost between Stripe and this page. Try connecting again — don't use a back-button or stale link.";
      case "stripe_denied":
        return detail
          ? `Stripe declined the connection (${detail}). Try again or contact support.`
          : "Stripe declined the connection. Try again or contact support.";
      case "not_signed_in":
        return "Your session expired during Stripe onboarding. Sign in and retry.";
      case "no_auth_token":
        return "Could not retrieve your auth token. Sign out and back in, then retry.";
      case "backend_error":
        if (detail === "oauth_state_expired")
          return "Stripe onboarding took too long (over 10 minutes). Click Connect Stripe again for a fresh link.";
        if (detail === "oauth_state_user_mismatch")
          return "The connection link was initiated by a different account. Sign in as the account that started the flow.";
        if (detail === "oauth_state_signature_invalid")
          return "The connection token was tampered with or isn't recognized. Click Connect Stripe again.";
        return detail
          ? `Backend rejected the connection: ${detail}`
          : "Backend rejected the connection. Check Railway logs.";
      case "network_error":
        return "Network error reaching the backend. Retry, then check your connection.";
      default:
        return "Something went wrong connecting Stripe. Please try again.";
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 pt-28 px-4 pb-12">
      <div className="mx-auto max-w-2xl space-y-6">

        {/* Stripe Connect return banner. Populated by the useEffect
            that reads ?stripe=connected|error from the callback-page
            redirect, then auto-dismissible. */}
        {stripeBanner?.kind === "success" && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-emerald-400">
                  Stripe connected
                </div>
                <div className="mt-1 text-xs text-emerald-400/80">
                  We'll show &ldquo;verified&rdquo; below as soon as Stripe
                  finishes reviewing your account.
                </div>
              </div>
              <button
                onClick={() => setStripeBanner(null)}
                className="text-xs text-emerald-400/60 hover:text-emerald-400"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}
        {stripeBanner?.kind === "error" && (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.06] px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold text-red-400">
                  Stripe connection didn&apos;t go through
                </div>
                <div className="mt-1 break-words text-xs text-red-400/80">
                  {stripeErrorCopy(stripeBanner.reason, stripeBanner.detail)}
                </div>
                {/* Diagnostic identifier hidden behind a disclosure so
                    the merchant sees calm copy by default; support
                    can still ask "click Show technical details and
                    paste it back" without confusing the merchant
                    with raw reason / detail strings up front. */}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-red-400/50 hover:text-red-400/80">
                    Show technical details
                  </summary>
                  <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-red-400/50">
                    reason: {stripeBanner.reason}
                    {stripeBanner.detail ? ` · detail: ${stripeBanner.detail}` : ""}
                  </div>
                </details>
              </div>
              <button
                onClick={() => setStripeBanner(null)}
                className="text-xs text-red-400/60 hover:text-red-400"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Founding badge */}
        {merchant.founding_merchant && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black">F</span>
              <div>
                <div className="text-sm font-bold text-emerald-400">Founding Merchant</div>
                <div className="text-xs text-emerald-400/60">$0 today · $29/month forever · 0% commission</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Onboarding checklist ──
            Only rendered while the merchant still has steps to complete.
            Once everything's done this disappears and the normal
            dashboard takes over. Stripe Connect is the primary CTA
            when it's the blocking step. */}
        {!onboardingComplete && (
          <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.05] to-zinc-900/60 p-5 shadow-[0_0_32px_rgba(0,255,163,0.08)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">Get Set Up</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {completedSteps} of {totalSteps} complete —{" "}
                  <span className="text-emerald-400">
                    {!stepStripe
                      ? "Connect Stripe to start getting paid"
                      : !stepInstall
                        ? "Add DUM Live to your website"
                        : "Waiting on your first sale"}
                  </span>
                </div>
              </div>
              <div className="text-xs font-mono text-emerald-400/70">
                {Math.round((completedSteps / totalSteps) * 100)}%
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>

            <ul className="space-y-3">
              {/* Step 1: Account created */}
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white line-through decoration-emerald-400/40">Founding spot claimed</div>
                  <div className="text-xs text-zinc-500">You're locked into the founding rate forever.</div>
                </div>
              </li>

              {/* Step 2: Connect Stripe */}
              <li className="flex items-start gap-3">
                {stepStripe ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-emerald-400/50" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepStripe ? "text-white line-through decoration-emerald-400/40" : "text-white"}`}>
                    Connect Stripe to receive payouts
                  </div>
                  <div className="text-xs text-zinc-500">
                    {stepStripe
                      ? "You'll get paid directly on every sale — 0% commission."
                      : "Required to accept payments. Takes about 2 minutes."}
                  </div>
                  {!stepStripe && (
                    <>
                      <p className="mt-2 text-[11px] text-zinc-500">
                        Your bank info goes to Stripe, never to DUM Club.
                      </p>
                      <button
                        onClick={connectStripe}
                        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_20px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300"
                      >
                        Connect Stripe →
                      </button>
                    </>
                  )}
                </div>
              </li>

              {/* Step 3: Add DUM Live to your website
                  Phase 3 of the merchant audit. Closes the "what's
                  next after Stripe?" gap by surfacing the Activate-
                  DUM-Live moment from the merchant home, instead of
                  forcing the merchant to navigate /dashboard ->
                  project page -> activation card on their own.
                  Deep-links to the merchant's first project when
                  one exists, else to /dashboard so they create the
                  storefront first. Marked complete by stepInstall
                  (which today proxies first-sale; see comment by
                  the const). */}
              <li className="flex items-start gap-3">
                {stepInstall ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : stepStripe ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-emerald-400/50" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-zinc-700" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepInstall ? "text-white line-through decoration-emerald-400/40" : stepStripe ? "text-white" : "text-zinc-300"}`}>
                    Add DUM Live to your website
                  </div>
                  <div className="text-xs text-zinc-500">
                    {stepInstall
                      ? "Your storefront is live and selling."
                      : firstProject
                        ? "Paste one script tag on your site — turns any page into a live storefront."
                        : "Set up your storefront first, then paste one script tag on your site."}
                  </div>
                  {!stepInstall && stepStripe && (
                    <Link
                      href={installLink}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_20px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300"
                    >
                      {firstProject ? "Add DUM Live to my site →" : "Set up my storefront →"}
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 4: First sale */}
              <li className="flex items-start gap-3">
                {stepFirstSale ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-zinc-700" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepFirstSale ? "text-white line-through decoration-emerald-400/40" : "text-zinc-300"}`}>
                    Make your first sale
                  </div>
                  <div className="text-xs text-zinc-500">
                    {stepFirstSale
                      ? "You&apos;re live. DUM Points are being issued automatically as loyalty rewards."
                      : "Share your storefront link or print the QR below."}
                  </div>
                </div>
              </li>
            </ul>
          </div>
        )}

        {/* Business info */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h2 className="text-lg font-bold text-white">{merchant.business_name}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-zinc-400">
            {merchant.business_type && <span>{merchant.business_type}</span>}
            {merchant.location_city && (
              <span>{merchant.location_city}{merchant.location_state ? `, ${merchant.location_state}` : ""}</span>
            )}
          </div>
        </div>

        {/* Connections — once onboarding is done this is the durable
            surface for managing the Stripe connection. While onboarding
            is in progress the checklist above is the primary CTA, so we
            only render this card when Stripe is already connected (to
            avoid duplicate "Connect" buttons). */}
        {stepStripe && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Payment Connections</h3>
          <div className="space-y-3">
            {/* Stripe Connect */}
            <div className="flex items-center justify-between rounded-xl border border-zinc-800/50 bg-zinc-950/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-sm font-bold text-violet-400">S</span>
                <div>
                  <div className="text-sm font-semibold text-white">Stripe</div>
                  <div className="text-[11px] text-zinc-500">Receive payouts from live sales</div>
                </div>
              </div>
              {merchant.stripe_connect_id ? (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">Connected</span>
              ) : (
                <button onClick={connectStripe} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-xs font-bold text-violet-400 transition hover:bg-violet-400/20">
                  Connect
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ── Stripe Verification card ──
            Re-skinned in Phase 2 of the merchant audit. The previous
            version always rendered with three "No"s right after
            Stripe connect, which read as "I'm broken" to a non-
            technical merchant — even though that's the normal
            "Stripe is reviewing your account" state.
            Render rules now (Q12):
              - status = verified    → not rendered (the checklist
                                       already says "Connect Stripe ✓")
              - has currently_due / disabled_reason → full diagnostic
              - status = pending and no issues → calm reassurance only
              - retrieve error          → support-friendly red panel
            Labels swapped from raw Stripe terms to merchant English
            (Q7); the raw API booleans now live behind a "What does
            this mean?" disclosure. */}
        {merchant.stripe_connect_id && (() => {
          // Compute render mode up-front so the JSX below stays
          // readable. Verified + no issues = nothing to show.
          const hasRetrieveError = !!stripeStatusError;
          const hasOpenRequirements =
            !!stripeStatus &&
            (stripeStatus.requirements_currently_due.length > 0 ||
              !!stripeStatus.disabled_reason);
          const isVerified =
            !!stripeStatus && stripeStatus.status === "verified";
          const isPendingClean =
            !!stripeStatus &&
            !isVerified &&
            !hasOpenRequirements;

          // Skip rendering entirely when fully verified — the
          // checklist already conveys the success state and a
          // "Verified" pill on its own is noise.
          if (isVerified && !hasRetrieveError) return null;

          return (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Stripe</h3>
                {stripeStatus && (
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                    stripeStatus.status === "verified"
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-400"
                      : stripeStatus.status === "restricted"
                        ? "border-red-400/30 bg-red-400/10 text-red-400"
                        : "border-amber-400/30 bg-amber-400/10 text-amber-400"
                  }`}>
                    {stripeStatus.status === "pending_verification"
                      ? "Stripe is reviewing"
                      : stripeStatus.status === "verified"
                        ? "Verified"
                        : stripeStatus.status === "restricted"
                          ? "Action needed"
                          : "Not connected"}
                  </span>
                )}
              </div>

              {hasRetrieveError ? (
                <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4">
                  <div className="text-xs font-bold text-red-400">Could not verify with Stripe</div>
                  <div className="mt-1 text-[11px] text-zinc-400">
                    We couldn&apos;t reach Stripe just now. This is usually temporary — refresh in a moment, or contact support if it keeps happening.
                  </div>
                  {/* Raw retrieve error stays available for support
                      diagnosis but doesn't lead the surface. */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-red-400/50 hover:text-red-400/80">
                      Show technical details
                    </summary>
                    <div className="mt-1.5 font-mono text-[10px] text-red-400/60 break-all">
                      {stripeStatusError}
                    </div>
                  </details>
                </div>
              ) : !stripeStatus ? (
                <div className="text-[11px] text-zinc-500">Loading…</div>
              ) : isPendingClean ? (
                /* Q8: calm reassurance for the common post-connect
                   case — Stripe is reviewing, nothing for the
                   merchant to do, no scary "all No" grid. */
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <div className="text-sm font-bold text-amber-400">
                    Stripe is reviewing your account
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-zinc-300">
                    This usually takes a few minutes. We&apos;ll show
                    &ldquo;Verified&rdquo; here as soon as Stripe finishes — you don&apos;t need to do anything else right now.
                  </div>
                  {/* Raw booleans behind a disclosure for the
                      curious / for support sessions. Default-collapsed
                      so a normal merchant never sees them. */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-300">
                      What does this mean?
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["Can accept payments", stripeStatus.charges_enabled],
                        ["Can receive payouts", stripeStatus.payouts_enabled],
                        ["Identity submitted", stripeStatus.details_submitted],
                      ] as const).map(([label, ok]) => (
                        <div key={label} className="rounded-lg border border-zinc-800/50 bg-zinc-950/50 px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">{label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${ok ? "text-emerald-400" : "text-zinc-500"}`}>
                            {ok ? "✓ Ready" : "— Pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ) : (
                /* Action-needed case: full diagnostic with merchant-
                   language labels and a Finish-on-Stripe CTA. */
                <div className="space-y-4">
                  {stripeStatus.disabled_reason && (
                    <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-red-400">Action needed</div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        Stripe has paused this account. Open the Stripe dashboard to see what&apos;s needed and resolve it.
                      </div>
                      {/* Raw Stripe disabled_reason hidden behind
                          disclosure — it's typically a code string
                          like "rejected.platform_fraud" that
                          confuses merchants. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-red-400/60 hover:text-red-400/80">
                          Show technical details
                        </summary>
                        <div className="mt-1.5 font-mono text-[10px] text-red-400/60 break-all">
                          {stripeStatus.disabled_reason}
                        </div>
                      </details>
                    </div>
                  )}

                  {stripeStatus.requirements_currently_due.length > 0 && (
                    <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-400">
                        Stripe needs a bit more info ({stripeStatus.requirements_currently_due.length} item{stripeStatus.requirements_currently_due.length === 1 ? "" : "s"})
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-400">
                        Open the Stripe dashboard to finish — you&apos;ll come right back here when it&apos;s done.
                      </div>
                      {/* Raw requirement codes behind a disclosure.
                          They look like "external_account",
                          "tos_acceptance.date", "person.dob.day" —
                          jargon to a non-technical merchant. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-300">
                          Show technical details
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                          {stripeStatus.requirements_currently_due.map((r) => (
                            <li key={r} className="font-mono">• {r}</li>
                          ))}
                        </ul>
                      </details>
                      <a
                        href="https://dashboard.stripe.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-amber-400/15 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-400 transition hover:bg-amber-400/25"
                      >
                        Finish on Stripe →
                      </a>
                    </div>
                  )}

                  {/* Eventually-due requirements stay behind a
                      disclosure — same as before; not surfaced to
                      casual readers. */}
                  {stripeStatus.requirements_eventually_due.length > 0 && (
                    <details className="rounded-xl border border-zinc-800/50 bg-zinc-950/50 p-3">
                      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                        Coming up later ({stripeStatus.requirements_eventually_due.length})
                      </summary>
                      <div className="mt-1.5 text-[11px] text-zinc-500">
                        Stripe will ask for these eventually — no rush.
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500">
                        {stripeStatus.requirements_eventually_due.map((r) => (
                          <li key={r} className="font-mono">• {r}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Raw boolean grid hidden behind a "What does this
                      mean?" disclosure — Phase 2 surfaces only
                      merchant-language labels by default. */}
                  <details className="rounded-xl border border-zinc-800/50 bg-zinc-950/50 p-3">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-300">
                      What does this mean?
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["Can accept payments", stripeStatus.charges_enabled],
                        ["Can receive payouts", stripeStatus.payouts_enabled],
                        ["Identity submitted", stripeStatus.details_submitted],
                      ] as const).map(([label, ok]) => (
                        <div key={label} className="rounded-lg border border-zinc-800/50 bg-zinc-950/50 px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">{label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${ok ? "text-emerald-400" : "text-zinc-500"}`}>
                            {ok ? "✓ Ready" : "— Pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>
          );
        })()}

        {/* Stats
            Empty-state: until the first sale lands, showing four zeros
            is demoralising and useless. Replace with a single "no data
            yet" panel and a concrete next-action CTA. The real grid
            only kicks in once there's something to measure. */}
        {stepFirstSale ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Transactions</div>
              <div className="mt-2 text-2xl font-bold text-white">{analytics?.total_orders ?? 0}</div>
              <div className="text-xs text-zinc-500">total</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Revenue</div>
              <div className="mt-2 text-2xl font-bold text-emerald-400">${(analytics?.total_revenue_usd ?? 0).toFixed(2)}</div>
              <div className="text-xs text-zinc-500">you keep 100% · 0% commission</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">DUM Issued</div>
              <div className="mt-2 text-2xl font-bold text-amber-400">{analytics?.total_dum_received ?? 0}</div>
              <div className="text-xs text-zinc-500">to customers</div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Page Views</div>
              <div className="mt-2 text-2xl font-bold text-white">{analytics?.total_views ?? 0}</div>
              <div className="text-xs text-zinc-500">total</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
              Your numbers show up here
            </div>
            <div className="text-base font-semibold text-white">
              Transactions · Revenue · DUM Issued · Page Views
            </div>
            <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400">
              Once your first sale lands, this panel lights up with live stats.
              No data yet — let's get you your first sale.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_20px_rgba(0,255,163,0.2)] transition hover:bg-emerald-300"
            >
              Set Up My Listing →
            </Link>
          </div>
        )}

        {/* QR Code */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Your QR Code</h3>
          <div className="flex items-center gap-4">
            <div className="flex h-32 w-32 items-center justify-center rounded-xl border border-zinc-700 bg-white p-2">
              {/* QR code via Google Charts API */}
              <img
                src={`https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(qrUrl)}`}
                alt="QR Code"
                className="h-full w-full"
              />
            </div>
            <div>
              <p className="text-sm text-zinc-400">Print this and display at your register.</p>
              <p className="text-xs text-zinc-500 mt-1">Customers scan to earn DUM Points on every visit.</p>
              <a
                href={`https://chart.googleapis.com/chart?cht=qr&chs=400x400&chl=${encodeURIComponent(qrUrl)}`}
                download="dum-club-qr.png"
                className="mt-3 inline-block rounded-lg border border-zinc-700 px-4 py-2 text-xs font-semibold text-white transition hover:border-zinc-600"
              >
                Download QR
              </a>
            </div>
          </div>
        </div>

        {/* Quick links — the two next-actions a converted merchant
            actually needs. The previous bottom-row had "Manage My
            Business" + "Browse Marketplace"; the second one routed
            converted merchants to the buyer-side /discover page,
            which is the wrong audience after they've already signed
            up. Phase 3 of the merchant audit replaced it with the
            "Add DUM Live to your website" deep-link so the merchant
            home consistently surfaces the activation moment instead
            of letting it hide on the project page. */}
        <div className="flex gap-3">
          <Link
            href={installLink}
            className="flex-1 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.04] px-4 py-3 text-center text-sm font-semibold text-emerald-400 transition hover:bg-emerald-400/[0.08]"
          >
            Add DUM Live to your website →
          </Link>
          <Link
            href="/dashboard"
            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-white"
          >
            Manage My Business
          </Link>
        </div>
      </div>
    </div>
  );
}
