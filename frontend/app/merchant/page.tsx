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
  square_location_id: string | null;
  square_status: string;
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
  const { user, getToken } = useAuth();

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

  // Square integration removed — Stripe is the ONLY payment processor per CLAUDE.md

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="text-sm text-zinc-500">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Merchant Portal</h1>
          <p className="text-sm text-zinc-400">Sign in to get started</p>
        </div>
      </div>
    );
  }

  // ── Signup form ──
  if (showSignup) {
    const programOpen = foundingStatus?.founding_program_open ?? true;
    const slotsRemaining = foundingStatus?.founding_slots_remaining ?? null;
    const totalCap = foundingStatus?.total_cap ?? 100;

    return (
      <div className="min-h-screen bg-zinc-950 pt-28 px-4">
        <div className="mx-auto max-w-md">
          {/* Founding status banner — renders whether the program is open
              or closed. Driven by /api/merchant/founding-status. */}
          {programOpen ? (
            <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.05] px-5 py-4 shadow-[0_0_24px_rgba(0,255,135,0.08)]">
              <div className="flex items-center gap-3">
                <span className="text-lg">⚡</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-emerald-400">
                    {slotsRemaining !== null ? (
                      <>
                        {slotsRemaining} of {totalCap} founding merchant spots remaining
                      </>
                    ) : (
                      <>Founding merchant program — {totalCap} spots</>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-emerald-400/70">
                    $0/month forever · No commission · No catch
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-4 rounded-2xl border border-zinc-700 bg-zinc-900/60 px-5 py-4">
              <div className="text-sm font-bold text-zinc-200">
                Founding program closed
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                Standard plan ${STANDARD_PLAN_PRICE_USD}/month. Unlimited transactions, loyalty built in.
              </div>
            </div>
          )}

          {/* ── Why DUM Club for merchants — 3 direct selling points.
               Only rendered inside the `if (showSignup)` branch, so
               it never shows on the merchant dashboard view. ── */}
          <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4">
            <ul className="space-y-2.5">
              {[
                "Keep more of every sale — no platform commissions, ever",
                "Customers earn DUM Points automatically — they come back without you paying for ads",
                "Free forever for founding merchants — $0/month, no catch",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2.5 text-sm leading-relaxed text-zinc-200"
                >
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-400">
                    ✓
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              {programOpen ? "Founding Merchant" : "Standard Plan"}
            </div>
            <h1 className="text-xl font-bold text-white mb-1">Join DUM Club</h1>
            <p className="text-sm text-zinc-400 mb-6">
              {programOpen
                ? "Free forever for founding members. No credit card required."
                : `Standard plan — $${STANDARD_PLAN_PRICE_USD}/month when billing launches. No card required today.`}
            </p>

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Business Name *</label>
                <input
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                  placeholder="Your business name"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Business Type</label>
                <input
                  value={bizType}
                  onChange={(e) => setBizType(e.target.value)}
                  placeholder="e.g. Restaurant, Retail, Salon"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">City</label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="City"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">State</label>
                  <input
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    placeholder="State"
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                  />
                </div>
              </div>
              <button
                onClick={handleSignup}
                disabled={saving}
                className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {saving
                  ? "Creating..."
                  : programOpen
                  ? "Become a Founding Merchant — Free"
                  : "Continue to signup"}
              </button>
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

            {/* Square removed per CLAUDE.md — Stripe is ONLY payment processor */}
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
