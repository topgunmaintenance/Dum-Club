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
        } else {
          setShowSignup(true);
        }
      }
    } catch {}
    setLoading(false);
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
            Sign in to claim your founding merchant spot. No credit card. No commission. $0/mo locked in forever.
          </p>

          <button
            onClick={() => login()}
            className="mt-8 inline-flex h-12 items-center justify-center rounded-xl bg-emerald-400 px-8 text-[13px] font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_24px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.4)]"
          >
            Sign In to Continue →
          </button>

          <p className="mt-4 text-[11px] text-zinc-500">
            Secured by Privy · Takes 30 seconds
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

          <div className="mb-10 text-center">
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl">
              Keep{" "}
              <span className="text-emerald-400" style={{ textShadow: "0 0 30px rgba(0,255,163,0.3)" }}>
                100% of every sale.
              </span>{" "}
              Forever.
            </h1>
            <p className="mx-auto mt-5 max-w-lg text-base font-medium leading-relaxed text-zinc-200">
              {programOpen
                ? "Founding 100 get $0/month — locked in forever. No credit card. No commission. Ever."
                : `Standard plan $${STANDARD_PLAN_PRICE_USD}/month. Zero commission, loyalty built in. No card today.`}
            </p>
          </div>

          {/* ── Whatnot contrast callout — direct fee comparison ── */}
          <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.04] to-zinc-900/60 p-5 sm:p-6">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/80">
              The math
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500">Whatnot</div>
                <div className="mt-1 text-lg font-bold text-red-400">8% + 2.9%</div>
                <div className="text-xs text-zinc-500">per sale, forever</div>
              </div>
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-400">DUM Club</div>
                <div className="mt-1 text-lg font-bold text-emerald-400">$0 per sale</div>
                <div className="text-xs text-emerald-400/80">flat $29–$99/mo · founding 100 free</div>
              </div>
            </div>
            <div className="mt-3 text-center text-xs text-zinc-400">
              On $10k/mo in sales, you keep <span className="font-bold text-emerald-400">~$1,090 more</span> per month with DUM Club.
            </div>
          </div>

          {/* ── 3-point sell ── */}
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 sm:p-6">
            <ul className="space-y-3">
              {[
                "Keep 100% of every sale — zero platform commission, forever",
                "Customers earn DUM Points automatically — they come back without you paying for ads",
                "Founding 100 get $0/month locked in forever — no card required",
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
                  &ldquo;I&apos;ve run my maintenance business for years. DUM Club is the first platform that doesn&apos;t take a cut of every job. Flat fee, zero commission — it just works.&rdquo;
                </p>
                <div className="mt-3 text-[11px] text-zinc-500">
                  <span className="font-bold text-white">Julian Mero</span> · Founder · Topgun Maintenance LLC · Founding Merchant #1
                </div>
              </div>
            </div>
          </div>

          {/* ── The form — one field only ──
               Dropped from 4 fields to 1. Rule of thumb: each extra
               field on a cold signup CTA costs ~10% completion. Biz
               type + city + state move to progressive profile after
               signup. */}
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-6 shadow-[0_0_32px_rgba(0,255,163,0.08)] sm:p-8">
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
                  ? "Claim My Founding Spot — Free Forever →"
                  : "Create Merchant Account →"}
              </button>
              <p className="text-center text-[11px] text-zinc-500">
                You can add business type, location, and offers on the next step.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Merchant dashboard ──
  if (!merchant) return null;

  const qrUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/business/${merchant.id}`;

  return (
    <div className="min-h-screen bg-zinc-950 pt-28 px-4 pb-12">
      <div className="mx-auto max-w-2xl space-y-6">

        {/* Founding badge */}
        {merchant.founding_merchant && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-black">F</span>
              <div>
                <div className="text-sm font-bold text-emerald-400">Founding Member</div>
                <div className="text-xs text-emerald-400/60">Free forever — $0/month, $0 platform fee</div>
              </div>
            </div>
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

        {/* Connections */}
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
              {merchant.stripe_connect_status === "connected" ? (
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-400">Connected</span>
              ) : (
                <button onClick={connectStripe} className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 text-xs font-bold text-violet-400 transition hover:bg-violet-400/20">
                  Connect
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Transactions</div>
            <div className="mt-2 text-2xl font-bold text-white">{analytics?.total_orders ?? 0}</div>
            <div className="text-xs text-zinc-500">total</div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Revenue</div>
            <div className="mt-2 text-2xl font-bold text-emerald-400">${(analytics?.total_revenue ?? 0).toFixed(2)}</div>
            <div className="text-xs text-zinc-500">total</div>
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

        {/* Quick links */}
        <div className="flex gap-3">
          <Link href="/dashboard" className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-white">
            Dashboard
          </Link>
          <Link href="/business" className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-center text-sm text-zinc-400 transition hover:border-zinc-700 hover:text-white">
            For Business
          </Link>
        </div>
      </div>
    </div>
  );
}
