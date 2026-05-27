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
  // /api/merchant/founding-status returns only this boolean now —
  // the count fields were stripped from the public response so
  // competitors can't curl the endpoint to derive live merchant
  // counts. Re-adding them here would just type a wire field
  // that no longer exists.
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
// hard-code the Starter tier anywhere (CLAUDE.md Section 7 rule). Falls
// back to 39 (Starter base per CLAUDE.md §3) when
// NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD is unset at build time.
const STANDARD_PLAN_PRICE_USD = Number(
  process.env.NEXT_PUBLIC_STANDARD_PLAN_PRICE_USD ?? 39
);

export default function MerchantPage() {
  const { user, getToken, login } = useAuth();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSignup, setShowSignup] = useState(false);

  // Founding program status. pulled from a public endpoint, no auth needed.
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

  // Live Stripe Connect verification. fetched from
  // /api/merchant/stripe-connect/status which does a fresh
  // Stripe.Account.retrieve and writes the resolved status back to
  // the merchants row. The shape includes charges/payouts/details
  // booleans and the requirements lists Stripe surfaces during
  // onboarding. `null` while loading; `error` if the backend's
  // Stripe.Account.retrieve fails (typically a key/account mismatch
  //. most often surfaces while live OAuth is still being set up).
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

  // ── 5-step checklist state (hoisted above all early returns) ──
  // These four hooks + two effects used to live below the
  //   if (!merchant) return null;
  // guard further down in the component (introduced in PR #187 /
  // QA T2). That violated the rules of hooks: on the first render
  // (merchant=null) zero of these hooks were called; on a later
  // render (merchant loaded) all six were called — React #310:
  // "Rendered more hooks than during the previous render."
  // /merchant white-screened for every signed-in merchant.
  //
  // Hoisting fixes the crash without changing behaviour: the
  // hooks now run on every render regardless of whether the
  // checklist JSX downstream actually renders. The JSX itself
  // still gates on merchant + firstProject + offer-fetch state.
  const [hasOffer, setHasOffer] = useState(false);
  const [installSeen, setInstallSeen] = useState(false);
  const [qrPrinted, setQrPrinted] = useState(false);
  const [stepLive, setStepLive] = useState(false);

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
    // Founding-status is public. fetch on mount regardless of auth so
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

  // Checklist signal effects — hoisted alongside the state above
  // so all hooks run on every render, regardless of which JSX
  // branch the early returns below ultimately pick.
  useEffect(() => {
    try {
      setInstallSeen(window.sessionStorage.getItem("dum-install-seen") === "1");
      setQrPrinted(window.sessionStorage.getItem("dum-qr-seen") === "1");
    } catch {
      // private mode — both stay false; non-blocking
    }
  }, []);

  useEffect(() => {
    if (!firstProject?.id) {
      setHasOffer(false);
      setStepLive(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [offersRes, statusRes] = await Promise.all([
          fetch(`${API_BASE}/api/offers/${encodeURIComponent(firstProject.id)}`),
          fetch(
            `${API_BASE}/api/projects/${encodeURIComponent(firstProject.id)}/live-status`,
          ),
        ]);
        if (cancelled) return;
        if (offersRes.ok) {
          const arr = await offersRes.json();
          setHasOffer(Array.isArray(arr) && arr.length > 0);
        }
        if (statusRes.ok) {
          const j = await statusRes.json();
          setStepLive(!!j.is_live);
        }
      } catch {
        // soft fail
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firstProject?.id]);

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
    // No auth header needed. /api/projects/ accepts owner_id as a
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
      // non-fatal. checklist still renders, just lands on /dashboard
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
      <div className="flex min-h-screen items-center justify-center bg-surface-card">
        <span className="text-sm text-secondary">Loading...</span>
      </div>
    );
  }

  if (!user) {
    // CRITICAL FIX: pre-fix this screen had no sign-in button at all —
    // every "Claim Your Free Spot" homepage click from a logged-out
    // visitor hit a dead end. Now renders a proper sign-in CTA that
    // kicks the Privy login flow, plus the founding-100 program-open
    // signal so we can flip CTA copy when slots close.
    const programOpen = foundingStatus?.founding_program_open ?? true;

    return (
      <div className="min-h-screen bg-surface-card px-4 pb-20 pt-28">
        <div className="mx-auto w-full max-w-md text-center">
          {/* Founding-100 scarcity pill removed — we no longer surface
              public merchant-count metrics. The H1 + description below
              still carry the "60 days free / lock in founding pricing"
              copy, so the value prop is intact. */}

          <h1 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">
            Join the first 100 merchants.{" "}
            <span className="text-brand-teal">Lock in founding pricing for life.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-base font-medium text-primary">
            Get 60 days free, then keep founding pricing for life. Flat monthly subscription plus a 1% sales fee. Industry-low (Whatnot takes 8%). No credit card.
          </p>

          <button
            onClick={() => login()}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-brand-teal px-8 text-[13px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover hover:"
          >
            Claim Your Founding Spot →
          </button>

          <p className="mt-2 text-[11px] text-secondary">
            Sign in with email or Google · Takes 30 seconds
          </p>
        </div>

        {/* What happens after you sign up — 3 steps */}
        <div className="mx-auto mt-16 w-full max-w-2xl">
          <h2 className="text-center text-lg font-extrabold tracking-tight text-primary">
            What happens after you sign up
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              { n: "1", title: "Sign in", body: "Use your email or Google. No password to remember." },
              { n: "2", title: "Enter business name", body: "One field. That's the whole signup." },
              { n: "3", title: "Connect Stripe", body: "When you're ready to take payments. Money goes straight to your bank." },
            ].map((step) => (
              <div key={step.n} className="rounded-2xl border border-default bg-surface-page p-5 text-center">
                <div className="mx-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-default bg-brand-teal-soft font-mono text-sm font-extrabold text-brand-teal">
                  {step.n}
                </div>
                <div className="mt-3 text-sm font-bold text-primary">{step.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-secondary">{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Mini FAQ */}
        <div className="mx-auto mt-14 w-full max-w-2xl">
          <h2 className="text-center text-lg font-extrabold tracking-tight text-primary">
            Quick questions
          </h2>
          <div className="mt-5 space-y-3">
            {[
              { q: "Do I need a website?", a: "No. You get a shop page on DUM Club either way. If you do have a website, you can add one line of code to show your live shop there too." },
              { q: "Do I need to be a Stripe user already?", a: "No. We set up Stripe for you in about 60 seconds when you're ready to take payments. Money goes straight to your bank." },
              { q: "How long does setup take?", a: "A few minutes. Sign in, enter your business name, and you're in. Connect Stripe whenever you're ready to sell." },
              { q: "What if I get stuck?", a: "Email or call Julian, the founder. Real person, same-day reply." },
            ].map((f) => (
              <details key={f.q} className="group rounded-2xl border border-default bg-surface-page p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-semibold text-primary">
                  {f.q}
                  <span className="text-secondary transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* Prefer to talk first */}
        <div className="mx-auto mt-12 w-full max-w-2xl text-center">
          <p className="text-sm text-secondary">
            Prefer to ask a question first? Use the inquiry form above. We respond within 24 hours.
          </p>
        </div>
      </div>
    );
  }

  // ── Signup form ──
  if (showSignup) {
    const programOpen = foundingStatus?.founding_program_open ?? true;

    return (
      <div className="min-h-screen bg-surface-card pt-24 px-4 pb-16">
        <div className="mx-auto max-w-2xl">

          {/* ── HERO ──
               Continues the homepage pitch instead of dropping a form
               in a void. Founding-100 scarcity pill removed — we no
               longer surface public merchant-count metrics; the H1 +
               paragraph below still carry "60 days free / lock in
               founding pricing for life" so the messaging is intact. */}

          <div className="mb-8 text-center">
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-primary sm:text-5xl">
              Join the first{" "}
              <span className="text-brand-teal" style={{ textShadow: "0 0 30px rgba(0,255,163,0.3)" }}>
                100 merchants.
              </span>{" "}
              Lock in founding pricing for life.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-base font-medium leading-relaxed text-primary">
              {programOpen
                ? "Get 60 days free, then keep founding pricing for life. Flat monthly subscription plus a 1% sales fee. Industry-low (Whatnot takes 8%). No credit card."
                : `Standard plan $${STANDARD_PLAN_PRICE_USD}/month plus a 1% sales fee per order. Loyalty rewards built in. No card today.`}
            </p>
          </div>

          {/* ── The form. one field only ──
               Dropped from 4 fields to 1. Rule of thumb: each extra
               field on a cold signup CTA costs ~10% completion. Biz
               type + city + state move to progressive profile after
               signup. Phase 4 of the merchant audit moved the form
               above the 5-expense-line comparison, the 3-point sell,
               and the founder testimonial. on a 393px-wide phone
               the input was previously ~2.5 screens of scroll below
               the H1, costing visible mobile abandonment. The proof
               / sell content sits below the form for hesitant
               readers; merchants who already know they want in see
               the form immediately. */}
          <div className="mb-6 rounded-2xl border border-default bg-brand-teal-soft p-6 sm:p-8">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">
              {programOpen ? "Claim your founding spot" : "Start a merchant account"}
            </div>
            <h2 className="mb-5 text-2xl font-extrabold text-primary">
              {programOpen ? "60 seconds. No card." : `$${STANDARD_PLAN_PRICE_USD}/mo. Cancel anytime.`}
            </h2>

            {error && <p className="mb-4 text-sm text-state-live">{error}</p>}

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-secondary">Business Name</label>
                <input
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSignup(); }}
                  placeholder="e.g. Topgun Maintenance LLC"
                  autoFocus
                  className="w-full rounded-xl border border-default bg-surface-card px-4 py-3 text-base text-primary placeholder:text-muted outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/30"
                />
              </div>
              <button
                onClick={handleSignup}
                disabled={saving || !bizName.trim()}
                className="w-full rounded-xl bg-brand-teal py-4 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover hover: disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "Claiming your spot..."
                  : programOpen
                  ? "Claim Your Founding Spot →"
                  : "Create Merchant Account →"}
              </button>
              <p className="text-center text-[11px] text-secondary">
                You can add business type, location, and offers on the next step.
              </p>
            </div>
          </div>

          {/* ── One-fee-replaces-five comparison ──
               Phase 4 of the merchant audit replaced the prior
               Whatnot-only contrast box with the same 5-expense-line
               framing used on the homepage. A barber, restaurant
               owner, mechanic, gym, contractor, or local shop has
               typically NEVER used Whatnot. leading the signup
               with "you'd save vs Whatnot" alienates the very
               audience this page is meant to convert. The five
               expense lines below are the bills a normal local
               business already pays today. */}
          <div className="mb-6 rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-muted p-5 sm:p-6">
            <div className="mb-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-teal">
                One flat fee instead of five
              </div>
              <div className="mt-2 text-base font-bold text-primary">
                DUM Club replaces five expense lines you already pay.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { name: "Delivery apps", fees: "15 to 30%", detail: "of every order" },
                { name: "Live selling", fees: "8% + fees", detail: "per sale" },
                { name: "Loyalty software", fees: "$50 to $300", detail: "per month" },
                { name: "SMS retention", fees: "$20 to $200", detail: "per month" },
              ].map((p) => (
                <div
                  key={p.name}
                  className="rounded-xl border border-red-500/15 bg-surface-card p-3 text-center"
                >
                  <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-secondary">
                    {p.name}
                  </div>
                  <div className="mt-1 font-mono text-base font-extrabold text-state-live/80">
                    {p.fees}
                  </div>
                  <div className="text-[10px] text-secondary">{p.detail}</div>
                </div>
              ))}
              <div className="col-span-2 rounded-xl border-2 border-brand-teal bg-gradient-to-b from-brand-teal-soft to-surface-muted p-3 text-center">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-brand-teal">
                  DUM Club
                </div>
                <div className="mt-1 font-mono text-base font-extrabold text-brand-teal">
                  From $39
                </div>
                <div className="text-[10px] text-brand-teal">
                  flat / month · 1% sales fee
                </div>
              </div>
            </div>
            <div className="mt-4 text-center text-xs text-primary">
              One bill. <span className="font-bold text-brand-teal">Keep your revenue.</span>
            </div>
          </div>

          {/* ── 3-point sell ── */}
          <div className="mb-6 rounded-2xl border border-default bg-surface-muted p-5 sm:p-6">
            <ul className="space-y-3">
              {[
                "Just a 1% sales fee per order (Whatnot takes 8%, DoorDash takes 15-30%)",
                "Customers earn DUM Points on every purchase. They can redeem these loyalty rewards at any DUM Club business, so customers come back without you paying for ads",
                "Get 60 days free and lock in founding pricing for life when you join the first 100 merchants",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 text-sm font-medium leading-relaxed text-primary"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-bold text-brand-teal">
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Founder testimonial. social proof, real face ── */}
          <div className="mb-6 rounded-2xl border border-default bg-surface-muted p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <img
                src="/Julian.jpeg"
                alt="Julian Mero. founder, Topgun Maintenance LLC"
                className="h-12 w-12 shrink-0 rounded-full border border-default object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-primary">
                  &ldquo;I&apos;ve run my maintenance business for years. DUM Club is the first platform that does not charge Whatnot-scale commission. Flat monthly fee plus just 1% per sale. It just works.&rdquo;
                </p>
                <div className="mt-3 text-[11px] text-secondary">
                  <span className="font-bold text-primary">Julian Mero</span> · Founder · Topgun Maintenance LLC · Founding Merchant #1
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

  // Build the QR target URL. During SSR `window` is undefined; fall back to
  // the public site host so the URL is always absolute (Google's old chart
  // API is dead, the new generator we use below requires a real URL or it
  // 404s the image).
  const qrOrigin =
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_SITE_URL || "https://dum.club";
  const qrUrl = `${qrOrigin}/business/${merchant.id}`;

  // ── Onboarding progress ──
  // A merchant who just signed up has an account + a founding spot. They
  // have NOT yet: connected Stripe (required to get paid), and made
  // their first sale. Surface those as a checklist at the very top of
  // the dashboard so "what's my next step?" is never ambiguous.
  //
  // stepStripe is true the moment OAuth completes. i.e. as soon as a
  // stripe_connect_id is on the row. The cached stripe_connect_status
  // string drifts through "connected" → "pending_verification" →
  // "verified" as Stripe's verification progresses, but the checklist
  // is asking "did you connect Stripe?", not "did Stripe verify you?".
  // Verification state is surfaced separately by the Stripe
  // Verification card below.
  const stepStripe = !!merchant.stripe_connect_id;
  // Step 3. "Add DUM Live to your website". has no direct
  // signal we can read (we don't have a server-side "embed
  // installed" flag, and even if we did, "merchant pasted the
  // snippet on a page we never see" can't be verified
  // remotely). A confirmed first sale proves the install
  // works end-to-end, so we use that as the completion proxy.
  // Until then, the step shows as the active next-action with
  // a deep-link CTA.
  const stepFirstSale = (analytics?.total_orders ?? 0) > 0;
  const stepInstall = stepFirstSale;

  // QA spec 5-step checklist. Same data signals — re-grouped to
  // match the directive's order + adds two new steps the previous
  // 4-step version didn't surface:
  //
  //   1. Connect Stripe              → stepStripe
  //   2. Add your first offer         → hasOffer (fetched in
  //                                      the effect below)
  //   3. Paste the snippet on your site
  //                                   → stepInstall (proxied via
  //                                      first sale or sessionStorage
  //                                      "dum-install-seen" set by
  //                                      /install)
  //   4. Print your QR                → printed flag in
  //                                      sessionStorage when /qr
  //                                      visited
  //   5. Go live for the first time   → stepLive (project.is_live
  //                                      or has-ever-been-live flag)
  //
  // The page always renders the checklist now, even when complete —
  // a 5/5 celebration line replaces the next-step copy.
  // (Hooks for hasOffer / installSeen / qrPrinted / stepLive +
  // their effects live above the early returns near line 95 to
  // satisfy the rules of hooks. See the "5-step checklist state"
  // block in the top hook section.)

  const stepSnippet = installSeen || stepInstall;
  const stepLiveEver = stepLive || stepFirstSale;
  const completedSteps = [
    stepStripe,
    hasOffer,
    stepSnippet,
    qrPrinted,
    stepLiveEver,
  ].filter(Boolean).length;
  const totalSteps = 5;
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
        return "The secure connection token was lost between Stripe and this page. Try connecting again, and don't use a back-button or stale link.";
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
    <div className="min-h-screen bg-surface-card pt-28 px-4 pb-12">
      <div className="mx-auto max-w-2xl space-y-6">

        {/* Stripe Connect return banner. Populated by the useEffect
            that reads ?stripe=connected|error from the callback-page
            redirect, then auto-dismissible. */}
        {stripeBanner?.kind === "success" && (
          <div className="rounded-2xl border border-default bg-brand-teal-soft px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-brand-teal">
                  Stripe connected
                </div>
                <div className="mt-1 text-xs text-brand-teal">
                  We'll show &ldquo;verified&rdquo; below as soon as Stripe
                  finishes reviewing your account.
                </div>
              </div>
              <button
                onClick={() => setStripeBanner(null)}
                className="text-xs text-brand-teal/60 hover:text-brand-teal"
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
                <div className="text-sm font-bold text-state-live">
                  Stripe connection didn&apos;t go through
                </div>
                <div className="mt-1 break-words text-xs text-state-live/80">
                  {stripeErrorCopy(stripeBanner.reason, stripeBanner.detail)}
                </div>
                {/* Inline retry. Every error reason here is retriable —
                    expired tokens, lost state, network blips, even a
                    Stripe-side cancel — and the only path forward is
                    to start a fresh authorize call. Before this button
                    the merchant had to scroll past the banner, find
                    the Stripe step card, and click "Connect Stripe"
                    there. Now the recovery action lives next to the
                    error explaining why they need it. */}
                <button
                  type="button"
                  onClick={() => {
                    setStripeBanner(null);
                    connectStripe();
                  }}
                  className="mt-3 inline-flex items-center rounded-lg bg-brand-teal px-4 py-2 text-xs font-bold text-black transition hover:bg-brand-teal-hover hover:text-white"
                >
                  Try connecting again →
                </button>
                {/* Diagnostic identifier hidden behind a disclosure so
                    the merchant sees calm copy by default; support
                    can still ask "click Show technical details and
                    paste it back" without confusing the merchant
                    with raw reason / detail strings up front. */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-state-live/50 hover:text-state-live/80">
                    Show technical details
                  </summary>
                  <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-state-live/50">
                    reason: {stripeBanner.reason}
                    {stripeBanner.detail ? ` · detail: ${stripeBanner.detail}` : ""}
                  </div>
                </details>
              </div>
              <button
                onClick={() => setStripeBanner(null)}
                className="text-xs text-state-live/60 hover:text-state-live"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Founding badge */}
        {merchant.founding_merchant && (
          <div className="rounded-2xl border border-default bg-brand-teal-soft px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black">F</span>
              <div>
                <div className="text-sm font-bold text-brand-teal">Founding Merchant</div>
                <div className="text-xs text-brand-teal/60">60 days free · Lock in founding pricing for life · 1% sales fee</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Onboarding checklist ──
            Always rendered. Even at 5 of 5 we keep the row visible
            with a celebration line so merchants can revisit /qr or
            /install, instead of the checklist disappearing once
            "complete". */}
        {(
          <div className="rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-muted p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-teal">Your Launch Checklist</div>
                <div className="mt-1 text-sm font-semibold text-primary">
                  {completedSteps} of {totalSteps} complete.{" "}
                  <span className="text-brand-teal">
                    {!stepStripe
                      ? "Connect Stripe to start getting paid"
                      : !hasOffer
                        ? "Add your first offer"
                        : !stepLiveEver
                          ? "Go live for the first time"
                          : !stepSnippet
                            ? "Paste the snippet on your site (optional)"
                            : !qrPrinted
                              ? "Print your QR"
                              : "You are set. Go live and start selling."}
                  </span>
                </div>
              </div>
              <div className="text-xs font-mono text-brand-teal">
                {Math.round((completedSteps / totalSteps) * 100)}%
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <div
                className="h-full rounded-full bg-brand-teal transition-all"
                style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
              />
            </div>

            <ul className="space-y-3">
              {/* Step 1 — Connect Stripe */}
              <li className="flex items-start gap-3">
                {stepStripe ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand-teal" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepStripe ? "text-primary line-through decoration-brand-teal" : "text-primary"}`}>
                    Connect Stripe
                  </div>
                  <div className="text-xs text-secondary">
                    {stepStripe
                      ? "Your bank account is connected. You get paid directly on every sale."
                      : "Safe payout setup. Money goes straight to your bank. Takes about 2 minutes."}
                  </div>
                  {!stepStripe && (
                    <>
                      <div className="mt-3 rounded-xl border border-default bg-surface-muted/40 p-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-teal">
                          Have these handy before you start
                        </div>
                        <ul className="mt-2 space-y-1.5 text-xs text-primary">
                          <li>• Business name and address</li>
                          <li>• Bank account and routing numbers (so we know where to send your money)</li>
                          <li>• Your SSN or EIN (same ID a bank asks for when you open an account)</li>
                        </ul>
                        <div className="mt-3 text-[11px] text-muted">
                          This is safe payout setup. Stripe is the same payment service Whatnot, Shopify, and Uber Eats use to pay their sellers. DUM Club never sees or stores your bank info. Stripe handles every sale and pays you directly.
                        </div>
                      </div>
                      <button
                        onClick={connectStripe}
                        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal px-6 text-sm font-bold text-black transition hover:bg-brand-teal-hover sm:w-auto"
                      >
                        Connect Stripe →
                      </button>
                    </>
                  )}
                </div>
              </li>

              {/* Step 2 — Add your first offer */}
              <li className="flex items-start gap-3">
                {hasOffer ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : stepStripe ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand-teal" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${hasOffer ? "text-primary line-through decoration-brand-teal" : "text-primary"}`}>
                    Add your first offer
                  </div>
                  <div className="text-xs text-secondary">
                    {hasOffer
                      ? "You have a live product or service customers can buy."
                      : "Pick one thing you sell and set a price."}
                  </div>
                  {!hasOffer && firstProject && (
                    <Link
                      href={`/project/${firstProject.slug || firstProject.id}/manage#offers`}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
                    >
                      Add offer →
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 3 — Paste the snippet on your site */}
              <li className="flex items-start gap-3">
                {stepSnippet ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : hasOffer ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand-teal" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepSnippet ? "text-primary line-through decoration-brand-teal" : "text-primary"}`}>
                    Paste the snippet on your site <span className="text-[11px] font-normal text-secondary">(optional)</span>
                  </div>
                  <div className="text-xs text-secondary">
                    {stepSnippet
                      ? "Your storefront is wired to your website."
                      : "One line of code. We walk you through it for Wix, Squarespace, Shopify, and WordPress. No website? Skip ahead, customers can still find your storefront on DUM Club."}
                  </div>
                  {!stepSnippet && (
                    <Link
                      href="/install"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
                    >
                      Get my snippet →
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 4 — Print your QR */}
              <li className="flex items-start gap-3">
                {qrPrinted ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : stepSnippet ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand-teal" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${qrPrinted ? "text-primary line-through decoration-brand-teal" : "text-primary"}`}>
                    Print your QR
                  </div>
                  <div className="text-xs text-secondary">
                    {qrPrinted
                      ? "Stick it at your counter, register, or window."
                      : "A code customers scan to land on your storefront."}
                  </div>
                  {!qrPrinted && (
                    <Link
                      href="/qr"
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
                    >
                      Print my QR →
                    </Link>
                  )}
                </div>
              </li>

              {/* Step 5 — Go live for the first time */}
              <li className="flex items-start gap-3">
                {stepLiveEver ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-bold text-black">✓</span>
                ) : qrPrinted ? (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-brand-teal" />
                ) : (
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-default" />
                )}
                <div className="flex-1">
                  <div className={`text-sm font-semibold ${stepLiveEver ? "text-primary line-through decoration-brand-teal" : "text-primary"}`}>
                    Go live for the first time
                  </div>
                  <div className="text-xs text-secondary">
                    {stepLiveEver
                      ? "Customers can watch you and buy in real time."
                      : "Camera and mic on. Customers see you in real time on your own site."}
                  </div>
                  {!stepLiveEver && firstProject && (
                    <Link
                      href={`/project/${firstProject.slug || firstProject.id}#project-live-host`}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
                    >
                      Go Live →
                    </Link>
                  )}
                </div>
              </li>
            </ul>
          </div>
        )}

        {/* Business info */}
        <div className="rounded-2xl border border-default bg-surface-muted p-5">
          <h2 className="text-lg font-bold text-primary">{merchant.business_name}</h2>
          <div className="mt-1 flex items-center gap-2 text-sm text-secondary">
            {merchant.business_type && <span>{merchant.business_type}</span>}
            {merchant.location_city && (
              <span>{merchant.location_city}{merchant.location_state ? `, ${merchant.location_state}` : ""}</span>
            )}
          </div>
        </div>

        {/* Connections. once onboarding is done this is the durable
            surface for managing the Stripe connection. While onboarding
            is in progress the checklist above is the primary CTA, so we
            only render this card when Stripe is already connected (to
            avoid duplicate "Connect" buttons). */}
        {stepStripe && (
        <div className="rounded-2xl border border-default bg-surface-muted p-5">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Payment Connections</h3>
          <div className="space-y-3">
            {/* Stripe Connect */}
            <div className="flex items-center justify-between rounded-xl border border-default bg-surface-card px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-sm font-bold text-violet-400">S</span>
                <div>
                  <div className="text-sm font-semibold text-primary">Stripe</div>
                  <div className="text-[11px] text-secondary">Receive payouts from live sales</div>
                </div>
              </div>
              {merchant.stripe_connect_id ? (
                <span className="rounded-full border border-default bg-brand-teal-soft px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-brand-teal">Connected</span>
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
            technical merchant. even though that's the normal
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

          // Skip rendering entirely when fully verified. the
          // checklist already conveys the success state and a
          // "Verified" pill on its own is noise.
          if (isVerified && !hasRetrieveError) return null;

          return (
            <div className="rounded-2xl border border-default bg-surface-muted p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Stripe</h3>
                {stripeStatus && (
                  <span className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                    stripeStatus.status === "verified"
                      ? "border-default bg-brand-teal-soft text-brand-teal"
                      : stripeStatus.status === "restricted"
                        ? "border-red-400/30 bg-red-400/10 text-state-live"
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
                // Soft amber, not red. The "Payment Connections" panel
                // above already shows Stripe as CONNECTED from the cached
                // merchant row, so a retrieve failure here is a transient
                // network blip. not a "your account is broken" event.
                // The amber colour reflects "we'll re-check"; the inline
                // Retry button gives the merchant agency without forcing
                // a full page refresh.
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <div className="text-xs font-bold text-amber-300">Couldn&apos;t reach Stripe just now</div>
                  <div className="mt-1 text-[11px] text-secondary">
                    Your Stripe connection is fine. We just couldn&apos;t pull the live verification status this time. Try again in a moment.
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const t = await getToken();
                      if (t) loadStripeStatus(t);
                    }}
                    className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300 transition hover:border-amber-400/50 hover:text-amber-200"
                  >
                    Retry verification
                  </button>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300/50 hover:text-amber-300/80">
                      Show technical details
                    </summary>
                    <div className="mt-1.5 font-mono text-[10px] text-amber-300/60 break-all">
                      {stripeStatusError}
                    </div>
                  </details>
                </div>
              ) : !stripeStatus ? (
                <div className="text-[11px] text-secondary">Loading…</div>
              ) : isPendingClean ? (
                /* Q8: calm reassurance for the common post-connect
                   case. Stripe is reviewing, nothing for the
                   merchant to do, no scary "all No" grid. */
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
                  <div className="text-sm font-bold text-amber-400">
                    Stripe is reviewing your account
                  </div>
                  <div className="mt-1 text-[12px] leading-relaxed text-primary">
                    This usually takes a few minutes. We&apos;ll show
                    &ldquo;Verified&rdquo; here as soon as Stripe finishes. you don&apos;t need to do anything else right now.
                  </div>
                  {/* Raw booleans behind a disclosure for the
                      curious / for support sessions. Default-collapsed
                      so a normal merchant never sees them. */}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary hover:text-primary">
                      What does this mean?
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["Can accept payments", stripeStatus.charges_enabled],
                        ["Can receive payouts", stripeStatus.payouts_enabled],
                        ["Identity submitted", stripeStatus.details_submitted],
                      ] as const).map(([label, ok]) => (
                        <div key={label} className="rounded-lg border border-default bg-surface-card px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-secondary">{label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${ok ? "text-brand-teal" : "text-secondary"}`}>
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
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-state-live">Action needed</div>
                      <div className="mt-1 text-[11px] text-secondary">
                        Stripe has paused this account. Open the Stripe dashboard to see what&apos;s needed and resolve it.
                      </div>
                      {/* Raw Stripe disabled_reason hidden behind
                          disclosure. it's typically a code string
                          like "rejected.platform_fraud" that
                          confuses merchants. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-state-live/60 hover:text-state-live/80">
                          Show technical details
                        </summary>
                        <div className="mt-1.5 font-mono text-[10px] text-state-live/60 break-all">
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
                      <div className="mt-1 text-[11px] text-secondary">
                        Open the Stripe dashboard to finish. you&apos;ll come right back here when it&apos;s done.
                      </div>
                      {/* Raw requirement codes behind a disclosure.
                          They look like "external_account",
                          "tos_acceptance.date", "person.dob.day" —
                          jargon to a non-technical merchant. */}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary hover:text-primary">
                          Show technical details
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 text-[11px] text-secondary">
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
                      disclosure. same as before; not surfaced to
                      casual readers. */}
                  {stripeStatus.requirements_eventually_due.length > 0 && (
                    <details className="rounded-xl border border-default bg-surface-card p-3">
                      <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary">
                        Coming up later ({stripeStatus.requirements_eventually_due.length})
                      </summary>
                      <div className="mt-1.5 text-[11px] text-secondary">
                        Stripe will ask for these eventually. No rush.
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-[11px] text-secondary">
                        {stripeStatus.requirements_eventually_due.map((r) => (
                          <li key={r} className="font-mono">• {r}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {/* Raw boolean grid hidden behind a "What does this
                      mean?" disclosure. Phase 2 surfaces only
                      merchant-language labels by default. */}
                  <details className="rounded-xl border border-default bg-surface-card p-3">
                    <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.12em] text-secondary hover:text-primary">
                      What does this mean?
                    </summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["Can accept payments", stripeStatus.charges_enabled],
                        ["Can receive payouts", stripeStatus.payouts_enabled],
                        ["Identity submitted", stripeStatus.details_submitted],
                      ] as const).map(([label, ok]) => (
                        <div key={label} className="rounded-lg border border-default bg-surface-card px-3 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-secondary">{label}</div>
                          <div className={`mt-0.5 text-xs font-bold ${ok ? "text-brand-teal" : "text-secondary"}`}>
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
            <div className="rounded-2xl border border-default bg-surface-muted p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Transactions</div>
              <div className="mt-2 text-2xl font-bold text-primary">{analytics?.total_orders ?? 0}</div>
              <div className="text-xs text-secondary">total</div>
            </div>
            <div className="rounded-2xl border border-default bg-surface-muted p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Revenue</div>
              <div className="mt-2 text-2xl font-bold text-brand-teal">${(analytics?.total_revenue_usd ?? 0).toFixed(2)}</div>
              <div className="text-xs text-secondary">you keep 99% · 1% sales fee</div>
            </div>
            <div className="rounded-2xl border border-default bg-surface-muted p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">DUM Issued</div>
              <div className="mt-2 text-2xl font-bold text-amber-400">{analytics?.total_dum_received ?? 0}</div>
              <div className="text-xs text-secondary">to customers</div>
            </div>
            <div className="rounded-2xl border border-default bg-surface-muted p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Page Views</div>
              <div className="mt-2 text-2xl font-bold text-primary">{analytics?.total_views ?? 0}</div>
              <div className="text-xs text-secondary">total</div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-default bg-surface-muted p-6 text-center">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">
              Your numbers show up here
            </div>
            <div className="text-base font-semibold text-primary">
              Transactions · Revenue · DUM Issued · Page Views
            </div>
            <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
              Once your first sale lands, this panel lights up with live stats.
              No data yet. let's get you your first sale.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
            >
              Set Up My Listing →
            </Link>
          </div>
        )}

        {/* QR Code */}
        <div className="rounded-2xl border border-default bg-surface-muted p-5">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">Your QR Code</h3>
          <div className="flex items-center gap-4">
            <div className="flex h-32 w-32 items-center justify-center rounded-xl border border-default bg-white p-2">
              {/* QR code generator. Google's chart.googleapis.com endpoint
                  was retired in 2024 and now 404s, which is why this image
                  was rendering as a broken placeholder. Switched to the
                  free api.qrserver.com generator (same query shape, returns
                  a PNG of the encoded URL). */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`}
                alt="QR Code"
                className="h-full w-full"
              />
            </div>
            <div>
              <p className="text-sm text-secondary">Print this and display at your register.</p>
              <p className="text-xs text-secondary mt-1">Customers scan to earn DUM Points on every visit.</p>
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}`}
                download="dum-club-qr.png"
                className="mt-3 inline-block rounded-lg border border-default px-4 py-2 text-xs font-semibold text-primary transition hover:border-strong"
              >
                Download QR
              </a>
            </div>
          </div>
        </div>

        {/* Quick links. the two next-actions a converted merchant
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
            className="flex-1 rounded-xl border border-default bg-brand-teal-soft px-4 py-3 text-center text-sm font-semibold text-brand-teal transition hover:bg-brand-teal-soft"
          >
            Add DUM Live to your website →
          </Link>
          <Link
            href="/dashboard"
            className="flex-1 rounded-xl border border-default bg-surface-muted px-4 py-3 text-center text-sm text-secondary transition hover:border-default hover:text-primary"
          >
            Manage My Business
          </Link>
        </div>
      </div>
    </div>
  );
}
