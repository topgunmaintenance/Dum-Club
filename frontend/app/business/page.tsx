"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth/AuthContext";
import { Starfield } from "../../components/Starfield";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const CATEGORIES = [
  "General",
  "Food & Beverage",
  "Health & Fitness",
  "Technology",
  "Creative",
  "Services",
  "Retail",
  "Gaming",
  "Education",
];

const BENEFITS = [
  {
    icon: "🏪",
    title: "AI-Built Storefront",
    desc: "Describe your business and get a live page with offers in under 60 seconds",
  },
  {
    icon: "💳",
    title: "Accept Payments",
    desc: "Stripe-powered checkout — your customers pay with credit card, you get paid",
  },
  {
    icon: "◆",
    title: "DUM Points Rewards",
    desc: "Your customers earn and spend DUM Points at your business for discounts",
  },
  {
    icon: "✓",
    title: "Verified Badge",
    desc: "Get verified to build trust — verified businesses rank higher in Discover",
  },
  {
    icon: "📊",
    title: "Analytics",
    desc: "See who visits, what sells, and how DUM Points drive repeat customers",
  },
  {
    icon: "🤖",
    title: "AI Co-Pilot",
    desc: "Get AI suggestions to improve your offers, descriptions, and pricing",
  },
];

const STEPS = [
  { num: "01", title: "Sign in", desc: "Use Google — takes 3 seconds, no crypto needed" },
  { num: "02", title: "Create your business", desc: "Name, category, and a short description" },
  { num: "03", title: "Launch a storefront", desc: "AI builds your page with offers automatically" },
  { num: "04", title: "Get verified", desc: "Submit for review to earn a verified badge" },
];

function Check() {
  return (
    <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 16 16">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" />
    </svg>
  );
}

export default function BusinessPage() {
  const { user, login, getToken } = useAuth();
  const router = useRouter();

  const [bizProfile, setBizProfile] = useState<any>(null);
  const [loadingBiz, setLoadingBiz] = useState(false);

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizCategory, setBizCategory] = useState("General");
  const [bizDesc, setBizDesc] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load existing business profile
  useEffect(() => {
    if (!user?.privyId) return;
    setLoadingBiz(true);
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/business/me`, { headers });
        if (res.ok) {
          const data = await res.json();
          setBizProfile(data.profile || null);
        }
      } catch {} finally {
        setLoadingBiz(false);
      }
    })();
  }, [user?.privyId]);

  async function handleCreate() {
    if (!bizName.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          business_name: bizName.trim(),
          category: bizCategory,
          short_description: bizDesc.trim() || null,
          contact_email: bizEmail.trim() || null,
          website: bizWebsite.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBizProfile(data.profile);
        setShowForm(false);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || "Failed to create business profile");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  async function handleRequestVerification() {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/request-verification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          website: bizProfile?.website,
          contact_email: bizProfile?.contact_email,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBizProfile(data.profile);
      }
    } catch {}
  }

  return (
    <div className="relative min-h-screen bg-base px-4 py-20 text-white sm:px-6">
      <Starfield count={50} />
      <div className="relative z-[1] mx-auto max-w-5xl">

        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">
            For Business
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Turn your idea into a
            <br />
            <span className="text-emerald-400">live business.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Create your storefront, accept payments, and reward customers with DUM Points — all powered by AI. No coding, no crypto knowledge required.
          </p>

          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {user ? (
              bizProfile ? (
                <Link
                  href="/dashboard"
                  className="rounded-xl bg-emerald-400 px-8 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
                >
                  Go to Dashboard
                </Link>
              ) : (
                <button
                  onClick={() => setShowForm(true)}
                  className="rounded-xl bg-emerald-400 px-8 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
                >
                  Create Your Business
                </button>
              )
            ) : (
              <button
                onClick={login}
                className="rounded-xl bg-emerald-400 px-8 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
              >
                Get Started with Google
              </button>
            )}
            <Link
              href="/discover"
              className="rounded-xl border border-zinc-700 px-8 py-3.5 text-sm font-bold text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            >
              Browse Businesses
            </Link>
          </div>
        </div>

        {/* Existing Business Profile Card */}
        {user && bizProfile && (
          <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-xl">
                🏢
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-white">{bizProfile.business_name}</span>
                  {bizProfile.verification_status === "verified" && (
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-400">
                      ✓ Verified
                    </span>
                  )}
                  {bizProfile.verification_status === "pending" && (
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-400">
                      Pending Review
                    </span>
                  )}
                  {bizProfile.verification_status === "unverified" && (
                    <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-zinc-500">
                      Unverified
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">{bizProfile.category}</div>
              </div>
            </div>
            {bizProfile.short_description && (
              <p className="mt-3 text-sm text-zinc-400">{bizProfile.short_description}</p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href="/dashboard"
                className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-2 text-xs font-bold text-emerald-400 transition hover:border-emerald-400/50 hover:bg-emerald-400/10"
              >
                Dashboard
              </Link>
              <Link
                href="/"
                className="rounded-lg border border-zinc-700 px-4 py-2 text-xs font-bold text-zinc-400 transition hover:border-zinc-500 hover:text-white"
              >
                Launch a Storefront
              </Link>
              {bizProfile.verification_status === "unverified" && (
                <button
                  onClick={handleRequestVerification}
                  className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-2 text-xs font-bold text-amber-400 transition hover:border-amber-400/50 hover:bg-amber-400/10"
                >
                  Request Verification
                </button>
              )}
            </div>
          </div>
        )}

        {/* Create Business Form Modal */}
        {showForm && user && !bizProfile && (
          <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-emerald-400/20 bg-zinc-950 p-6">
            <h2 className="text-lg font-bold text-white">Create your business profile</h2>
            <p className="mt-1 text-sm text-zinc-500">This is your identity on Dum Club. You can update it anytime.</p>

            <div className="mt-5 space-y-3">
              <input
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                placeholder="Business name *"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={bizCategory}
                  onChange={(e) => setBizCategory(e.target.value)}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input
                  value={bizEmail}
                  onChange={(e) => setBizEmail(e.target.value)}
                  placeholder="Contact email (optional)"
                  className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                />
              </div>
              <input
                value={bizWebsite}
                onChange={(e) => setBizWebsite(e.target.value)}
                placeholder="Website URL (optional)"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />
              <textarea
                value={bizDesc}
                onChange={(e) => setBizDesc(e.target.value)}
                placeholder="Short description of your business"
                rows={2}
                className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
              />

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleCreate}
                  disabled={!bizName.trim() || saving}
                  className="rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create Business"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setError(""); }}
                  className="rounded-xl border border-zinc-700 px-6 py-3 text-sm text-zinc-400 transition hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {user && loadingBiz && !bizProfile && (
          <div className="mt-12 text-center text-sm text-zinc-600">Loading your business profile...</div>
        )}

        {/* Benefits grid */}
        <div className="mt-20">
          <div className="text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              Everything you need to sell online
            </h2>
            <p className="mt-3 text-sm text-zinc-400">
              No monthly fees. No code. Just describe what you do.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div
                key={b.title}
                className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 transition hover:border-zinc-700"
              >
                <div className="text-2xl">{b.icon}</div>
                <div className="mt-3 text-sm font-bold text-white">{b.title}</div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-500">{b.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="mt-20 rounded-2xl border border-zinc-800 bg-zinc-950 px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              How it works
            </h2>
            <p className="mt-3 text-sm text-zinc-400">
              Go from idea to live business in 4 steps.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s) => (
                <div key={s.num} className="rounded-xl border border-zinc-800 bg-base p-5 text-left">
                  <div className="font-mono text-lg font-bold text-emerald-400/40">{s.num}</div>
                  <div className="mt-2 text-sm font-bold text-white">{s.title}</div>
                  <div className="mt-1 text-xs text-zinc-500">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* DUM Points for business */}
        <div className="mt-12 rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              DUM Points = built-in loyalty
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Every Dum Club user has DUM Points. When they spend points at your business,
              they get 10% off and you receive the points. It&apos;s automatic loyalty — no setup, no extra cost.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-center">
                <div className="text-2xl font-extrabold text-emerald-400">10%</div>
                <div className="mt-1 text-xs text-zinc-500">Discount for customers using DUM</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-center">
                <div className="text-2xl font-extrabold text-violet-400">+2</div>
                <div className="mt-1 text-xs text-zinc-500">DUM earned per purchase by buyers</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-center">
                <div className="text-2xl font-extrabold text-amber-400">Free</div>
                <div className="mt-1 text-xs text-zinc-500">No cost — points come from the platform</div>
              </div>
            </div>
          </div>
        </div>

        {/* Verification trust */}
        <div className="mt-12 rounded-2xl border border-zinc-800 bg-zinc-950 px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-center text-2xl font-extrabold text-white sm:text-3xl">
              Get verified, build trust
            </h2>
            <p className="mt-3 text-center text-sm text-zinc-400">
              Verified businesses get a badge, higher ranking in Discover, and more customer confidence.
            </p>

            <div className="mt-8 space-y-3">
              {[
                "Create your business profile (name, category, description)",
                "Launch at least one storefront with offers",
                "Submit for verification from your dashboard",
                "Our team reviews and approves within 48 hours",
                "Your verified badge appears on all your storefronts",
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-zinc-800/50 bg-base px-4 py-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-400/20 bg-emerald-400/5 text-[10px] font-bold text-emerald-400">
                    {i + 1}
                  </div>
                  <span className="text-sm text-zinc-300">{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          {user ? (
            bizProfile ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-xl bg-emerald-400 px-8 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
              >
                Go to Dashboard
              </Link>
            ) : (
              <button
                onClick={() => { setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                className="inline-flex items-center rounded-xl bg-emerald-400 px-8 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
              >
                Create Your Business
              </button>
            )
          ) : (
            <button
              onClick={login}
              className="inline-flex items-center rounded-xl bg-emerald-400 px-8 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
            >
              Get Started Free
            </button>
          )}
          <div className="mt-4">
            <Link href="/" className="text-sm text-zinc-500 transition hover:text-zinc-300">
              ← Back to home
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}
