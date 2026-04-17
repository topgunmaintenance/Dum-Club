"use client";

/**
 * /business — seller recruitment landing page with sub-tabs.
 *
 * All seller-pitch content lives here — pricing, calculators,
 * competitor comparisons, retention demos. The homepage stays
 * buyer-focused (live sales grid + search). CLAUDE.md v5.0
 * Section 3 pricing is the source of truth for every number.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "../../lib/apiBase";

type FoundingStatus = {
  founding_slots_remaining: number;
  total_cap: number;
  founding_program_open: boolean;
};

/* ─── Sub-tab definitions ─── */
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "pricing", label: "Pricing" },
  { id: "calculator", label: "Calculator" },
  { id: "compare", label: "Compare" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function BusinessPage() {
  const searchParams = useSearchParams();
  const [founding, setFounding] = useState<FoundingStatus | null>(null);
  const initialTab = (searchParams.get("tab") as TabId) || "overview";
  const [activeTab, setActiveTab] = useState<TabId>(
    TABS.some((t) => t.id === initialTab) ? initialTab : "overview"
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/merchant/founding-status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setFounding(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const slotsRemaining = founding?.founding_slots_remaining ?? null;
  const totalCap = founding?.total_cap ?? 100;
  const programOpen = founding?.founding_program_open ?? true;
  const claimed = slotsRemaining != null ? totalCap - slotsRemaining : null;

  return (
    <main className="min-h-screen bg-[#060606] text-white">
      {/* ── Hero (always visible) ────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-8 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_top,rgba(0,255,163,0.12),transparent_65%)]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[0.06] px-4 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              {claimed != null ? `${claimed} of ${totalCap} founding spots claimed` : "Founding 100 · spots limited"}
              <span className="ml-2 text-emerald-400/70">· $0 now · $29/mo locked in forever</span>
            </span>
          </div>

          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Keep Everything{" "}
            <span className="text-emerald-400" style={{ textShadow: "0 0 40px rgba(0,255,163,0.35)" }}>
              You Earn.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            Flat monthly fee. Zero commission. Zero per-sale fees. The first 100 merchants join free and lock in $29/month forever after the founding period.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/merchant"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black shadow-[0_0_32px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300 hover:shadow-[0_0_48px_rgba(0,255,163,0.4)]"
            >
              Claim Your Free Spot →
            </Link>
            <Link
              href="/discover"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/60 px-8 py-4 text-sm font-bold text-zinc-200 transition hover:border-emerald-400/40 hover:text-emerald-400"
            >
              See the Marketplace
            </Link>
          </div>
        </div>
      </section>

      {/* ── Sub-tab navigation ───────────────────────── */}
      <div className="sticky top-0 z-30 border-b border-zinc-800 bg-[#060606]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 border-b-2 px-5 py-3.5 text-[12px] font-bold uppercase tracking-[0.15em] transition ${
                activeTab === tab.id
                  ? "border-emerald-400 text-emerald-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 py-12">
        {activeTab === "overview" && <OverviewTab claimed={claimed} totalCap={totalCap} programOpen={programOpen} />}
        {activeTab === "pricing" && <PricingTab />}
        {activeTab === "calculator" && <CalculatorTab />}
        {activeTab === "compare" && <CompareTab />}
      </div>

      {/* ── Talk to Julian CTA (always visible) ──────── */}
      <section className="border-t border-zinc-800 px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-3xl border border-zinc-700/50 bg-zinc-900/60 p-10 text-center backdrop-blur-sm">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
            Questions?
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Talk to Julian.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-zinc-400">
            I built DUM Club. I also run Topgun Maintenance LLC, the founding merchant. Email or call me directly — I&apos;ll get back same day.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
            <a
              href="mailto:julian@topgunmaintenance.com"
              className="font-mono text-sm text-emerald-400 transition hover:text-emerald-300"
            >
              julian@topgunmaintenance.com
            </a>
            <span className="hidden text-zinc-700 sm:inline">·</span>
            <a
              href="tel:+12014521986"
              className="font-mono text-sm text-emerald-400 transition hover:text-emerald-300"
            >
              +1 (201) 452-1986
            </a>
          </div>
        </div>
      </section>

      <div className="border-t border-zinc-800 px-4 py-10 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-700">
          Stripe-powered payments · 0% commission · Founding 100 · DUM Club v5.0
        </p>
      </div>
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════
   OVERVIEW TAB — fee cards, what's included, founding 100
   ═══════════════════════════════════════════════════════════ */
function OverviewTab({
  claimed,
  totalCap,
  programOpen,
}: {
  claimed: number | null;
  totalCap: number;
  programOpen: boolean;
}) {
  return (
    <>
      {/* Fee comparison cards */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
            What you really pay
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            On $10,000/month in sales
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">
            Other platforms take a cut of every transaction. DUM Club charges one flat fee — no matter how much you sell.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            { name: "Whatnot", fees: "~$1,090", detail: "8% + 2.9% + $0.30 per sale", muted: true },
            { name: "Commonsold", fees: "$500+", detail: "% per sale + monthly", muted: true },
            { name: "Google Maps", fees: "$500–$2,000", detail: "monthly ads to rank", muted: true },
            { name: "DUM Club", fees: "$29–$99", detail: "flat monthly, 0% per sale", muted: false },
          ].map((p) => (
            <div
              key={p.name}
              className={`rounded-2xl border p-6 text-center backdrop-blur-sm transition ${
                p.muted
                  ? "border-red-500/20 bg-zinc-900/60"
                  : "border-2 border-emerald-400/50 bg-gradient-to-b from-emerald-400/[0.08] to-zinc-900/60 shadow-[0_0_40px_rgba(0,255,163,0.2)]"
              }`}
            >
              <div className={`mb-2 text-[10px] font-bold uppercase tracking-[0.2em] ${p.muted ? "text-zinc-400" : "text-emerald-400"}`}>
                {p.name}
              </div>
              <div className={`font-mono text-3xl font-extrabold ${p.muted ? "text-red-400/80" : "text-emerald-400"}`}>
                {p.fees}
              </div>
              <div className="mt-2 text-[11px] text-zinc-400">{p.detail}</div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-zinc-300">
          Sell $10,000 or $100,000 a month —{" "}
          <span className="font-bold text-emerald-400">your fee never changes.</span>
        </p>
      </section>

      {/* How it works — 3 steps */}
      <section className="mb-16">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 px-8 py-12 backdrop-blur-sm sm:px-12 sm:py-16">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-emerald-400">How it works</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Why sellers leave Whatnot for DUM Club.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-200 sm:text-lg">
            One flat fee. Zero commission. Customers who come back.
          </p>
          <div className="mt-12 grid gap-3 sm:grid-cols-3">
            {[
              { n: "01", title: "No 8% Tax on Every Sale", desc: "Whatnot charges 8% + 2.9%. We charge $29–$99/month. Flat. Forever. First 100 merchants free." },
              { n: "02", title: "Stripe Pays You Direct", desc: "Connect Stripe once. Every sale hits your bank — not our account first, not a platform wallet." },
              { n: "03", title: "Customers Come Back Automatically", desc: "DUM Points turn one-time buyers into regulars. No other live-selling platform has this." },
            ].map((step) => (
              <div
                key={step.n}
                className="group relative overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-6 backdrop-blur-sm transition hover:border-emerald-400/30"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/20 font-mono text-sm font-extrabold text-emerald-400">
                  {step.n}
                </div>
                <div className="mt-3 text-base font-bold text-white">{step.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">Every tier includes</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">The basics come standard.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "DUM Points loyalty", desc: "Customers earn points on every purchase. Redeemable at any DUM Club seller — the loyalty network that makes them come back." },
            { title: "Stripe direct payouts", desc: "Money goes straight to your bank via Stripe Connect. No marketplace holding your funds. No payout delays." },
            { title: "Storefront on the marketplace", desc: "A real buyable page with your offers, photos, and Stripe checkout. Shareable anywhere." },
            { title: "AI sales assistant", desc: "A customer-facing chatbot that answers questions using your real offer data. Helps close sales 24/7." },
            { title: "Listed on /discover", desc: "The marketplace browse page with search, live streaming, and local discovery. Free organic traffic." },
            { title: "Founding merchant badge", desc: "Permanent badge on your profile if you join the founding 100. You locked in early — we don't forget it." },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-5 backdrop-blur-sm transition hover:border-emerald-400/30">
              <div className="mb-2 text-sm font-bold text-white">{item.title}</div>
              <p className="text-[13px] leading-relaxed text-zinc-400">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Founding 100 */}
      <section>
        <div className="rounded-3xl border border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.08] to-zinc-950 p-10 text-center shadow-[0_0_48px_rgba(0,255,163,0.1)]">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">Limited · Founding 100</div>
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            The first 100 merchants get in free.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-400">
            $0 during the founding period. Locked at $29/month forever after. Founding merchant badge permanent on your profile.
          </p>
          <div className="mt-8 inline-flex items-baseline gap-3 rounded-2xl border border-zinc-700/50 bg-zinc-900/60 px-6 py-4 backdrop-blur-sm">
            <span className="font-mono text-4xl font-extrabold text-emerald-400">
              {claimed != null ? claimed : "—"}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">of {totalCap} founding spots claimed</span>
          </div>
          <div className="mt-8">
            <Link
              href="/merchant"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black shadow-[0_0_32px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300 hover:shadow-[0_0_48px_rgba(0,255,163,0.4)]"
            >
              {programOpen ? "Claim a Founding Spot →" : "Join the Waitlist →"}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRICING TAB — tier cards + features grid
   ═══════════════════════════════════════════════════════════ */
function PricingTab() {
  const tiers = [
    {
      name: "Starter",
      price: "$29",
      period: "/mo",
      desc: "Everything you need to sell online",
      features: ["Storefront on marketplace", "DUM Points built in", "Basic analytics", "Stripe direct payouts", "Listed on Discover"],
      cta: "Get Started",
      highlight: false,
    },
    {
      name: "Growth",
      price: "$49",
      period: "/mo",
      desc: "Retain customers automatically",
      features: ["Everything in Starter", "Featured placement", "AI retention agent", "Google review display", "Best Deals eligibility"],
      cta: "Most Popular",
      highlight: true,
    },
    {
      name: "Pro",
      price: "$99",
      period: "/mo",
      desc: "Full automation + social media",
      features: ["Everything in Growth", "AI social media management", "Homepage featured slot", "Cross-business promos", "Full analytics dashboard"],
      cta: "Go Pro",
      highlight: false,
    },
  ];

  return (
    <>
      {/* Tier cards */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">Pricing</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Flat fee. <span className="text-emerald-400">Zero commission. Ever.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
            The first 100 merchants join free and lock in $29/mo forever. No percentage cut on any sale.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${
                tier.highlight
                  ? "border-emerald-400/40 bg-gradient-to-b from-emerald-400/[0.08] to-zinc-950 shadow-[0_0_40px_rgba(0,255,163,0.08)]"
                  : "border-zinc-800/60 bg-zinc-950/80 hover:border-zinc-700"
              }`}
            >
              {tier.highlight && (
                <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />
              )}
              <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-zinc-500">{tier.name}</div>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-3xl font-black text-white">{tier.price}</span>
                <span className="text-sm text-zinc-500">{tier.period}</span>
              </div>
              <div className="mb-5 text-[12px] text-zinc-400">{tier.desc}</div>
              <div className="mb-5 space-y-2">
                {tier.features.map((f) => (
                  <div key={f} className="flex items-center gap-2 text-[12px] text-zinc-300">
                    <span className="text-emerald-400">✓</span>
                    {f}
                  </div>
                ))}
              </div>
              <Link
                href="/merchant"
                className={`block w-full rounded-xl py-2.5 text-center text-[12px] font-bold transition ${
                  tier.highlight
                    ? "bg-emerald-400 text-black hover:bg-emerald-300"
                    : "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                }`}
              >
                {tier.cta} →
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-6 text-center text-[11px] text-zinc-500">
          Need white-label loyalty? <span className="font-bold text-emerald-400">Business tier from $499/mo</span> · Enterprise from $2,000/mo
        </div>
      </section>

      {/* ── Paid Placement Surfaces ── */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">Boost your visibility</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Get discovered <span className="text-emerald-400">faster.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
            Flat-rate placements — no bidding, no per-click fees. Pay once, stay visible.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            {
              name: "Featured Merchant",
              price: "$49",
              period: "/week",
              desc: "Top of Discover page",
              perks: ["Featured badge on your storefront", "Priority in category browse", "Highlighted in search results"],
              icon: "⭐",
            },
            {
              name: "Category Sponsor",
              price: "$199",
              period: "/mo",
              desc: "Own your category",
              perks: ["Top position in your category", "Sponsor badge on category page", "Included in Best Deals This Week"],
              icon: "🏷️",
            },
            {
              name: "Ticker Boost",
              price: "$19",
              period: "/week",
              desc: "Homepage live ticker",
              perks: ["Your sales appear in the live ticker", "Emerald highlight on your entries", "Visible to every homepage visitor"],
              icon: "📡",
            },
          ].map((placement) => (
            <div
              key={placement.name}
              className="rounded-2xl border border-zinc-800/60 bg-zinc-950/80 p-6 transition-all duration-300 hover:border-emerald-400/30"
            >
              <div className="mb-3 text-2xl">{placement.icon}</div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-zinc-500">{placement.name}</div>
              <div className="mb-1 flex items-baseline gap-1">
                <span className="text-3xl font-black text-white">{placement.price}</span>
                <span className="text-sm text-zinc-500">{placement.period}</span>
              </div>
              <div className="mb-5 text-[12px] text-zinc-400">{placement.desc}</div>
              <div className="space-y-2">
                {placement.perks.map((p) => (
                  <div key={p} className="flex items-center gap-2 text-[12px] text-zinc-300">
                    <span className="text-emerald-400">✓</span>
                    {p}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-[11px] text-zinc-500">
          All placements are flat-rate — no per-click, no bidding, no percentage of sales. Ever.
        </p>
      </section>

      {/* ── Flat-fee Add-ons ── */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">Stack on any tier</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Add-ons. <span className="text-emerald-400">Flat fee. No surprises.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-400">
            Layer these onto any tier to unlock more without upgrading. Every add-on is a flat monthly fee.
          </p>
        </div>

        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.04] to-zinc-950 p-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1">
              <span className="text-sm">🚀</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Points Boost</span>
            </div>
            <div className="mb-1 flex items-baseline gap-1">
              <span className="text-3xl font-black text-white">$19</span>
              <span className="text-sm text-zinc-500">/mo</span>
              <span className="ml-2 text-[11px] text-zinc-600">or $49/mo for 3× multiplier</span>
            </div>
            <p className="mb-4 text-[12px] leading-relaxed text-zinc-400">
              Give your customers a higher DUM Points multiplier on every purchase. More points means they come back faster and spend more at your store.
            </p>
            <div className="space-y-2">
              {["2× points at $19/mo · 3× points at $49/mo", "Customers earn faster at YOUR store", "Boosts repeat purchase rate", "Stackable with any tier"].map((f) => (
                <div key={f} className="flex items-center gap-2 text-[12px] text-zinc-300">
                  <span className="text-emerald-400">✓</span>
                  {f}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.04] to-zinc-950 p-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1">
              <span className="text-sm">📅</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Service Pro</span>
            </div>
            <div className="mb-1 flex items-baseline gap-1">
              <span className="text-3xl font-black text-white">$29</span>
              <span className="text-sm text-zinc-500">/mo</span>
            </div>
            <p className="mb-4 text-[12px] leading-relaxed text-zinc-400">
              Built for service businesses. Unlock Book-Now, calendar scheduling, and automated appointment reminders on your storefront.
            </p>
            <div className="space-y-2">
              {["Book-Now button on your storefront", "Calendar sync + availability slots", "Automated appointment reminders", "Starter + Service Pro = $58/mo total"].map((f) => (
                <div key={f} className="flex items-center gap-2 text-[12px] text-zinc-300">
                  <span className="text-emerald-400">✓</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section>
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-emerald-400">Platform</div>
        <h2 className="mb-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Everything you need. <span className="text-emerald-400">Nothing you don&apos;t pay for.</span>
        </h2>
        <p className="mb-10 max-w-xl text-base font-medium text-white">
          Live selling, loyalty points, AI retention, and local deals discovery — all in one flat-fee platform.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { tag: "Live", title: "Live Selling", desc: "Go live and sell to your audience in real time. Just like Whatnot — but you keep 100% of every sale." },
            { tag: "Loyalty", title: "DUM Points Loyalty Network", desc: "Every purchase earns points redeemable at ANY business on the platform. Customers come back automatically." },
            { tag: "AI", title: "AI Retention Agent", desc: "Automated point reminders, deal pushes, and expiry alerts. Replace $500+/mo direct mail campaigns." },
            { tag: "Deals", title: "Best Deals Discovery", desc: "Customers discover your deals through local search — and earn loyalty points that bring them back." },
            { tag: "Social", title: "AI Social Media Manager", desc: "Automated Instagram, TikTok, and Facebook posting based on your active deals. Replace agency bills." },
            { tag: "Payments", title: "Stripe Direct Payouts", desc: "Customers pay by card. You get paid direct to your bank. No middleman taking a cut of your sales." },
          ].map((f) => (
            <div key={f.title} className="group rounded-xl border border-zinc-800/40 bg-gradient-to-br from-zinc-900/60 to-zinc-950 p-7 hover:border-emerald-400/15">
              <div className="mb-3 inline-block rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                {f.tag}
              </div>
              <h3 className="mb-2 text-lg font-bold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-zinc-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI Customer Assistant Demo */}
      <section className="mt-16">
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/80 p-6 sm:p-8">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400/60">Customer retention, automated</div>
          <h3 className="text-xl font-extrabold text-white sm:text-2xl">Your customers get 24/7 answers about your business.</h3>
          <p className="mt-2 max-w-lg text-base font-medium text-zinc-200">Built into every storefront. Answers buyer questions instantly, books services, and closes sales — while you sleep.</p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="flex items-center gap-3">
                <img src="/Julian.jpeg" alt="Topgun Maintenance LLC" className="h-10 w-10 rounded-full object-cover border border-emerald-400/25" />
                <div>
                  <div className="text-sm font-bold text-white">Topgun Maintenance LLC</div>
                  <div className="text-[10px] text-zinc-500">Aircraft maintenance · MMU</div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {[
                  { name: "Annual Inspection (FAR 91)", price: "$850" },
                  { name: "100-Hour Inspection", price: "$650" },
                  { name: "AOG Emergency Response", price: "$500" },
                ].map((offer) => (
                  <div key={offer.name} className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 py-2">
                    <span className="text-[12px] text-zinc-300">{offer.name}</span>
                    <span className="font-mono text-[12px] font-bold text-emerald-400">{offer.price}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <div className="mb-3 flex items-center gap-2">
                <img src="/Julian.jpeg" alt="AI Assistant" className="h-6 w-6 rounded-full object-cover border border-emerald-400/25" />
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">AI Assistant</span>
              </div>
              <div className="space-y-3">
                <div className="flex justify-end">
                  <div className="rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[12px] text-zinc-300">
                    What&apos;s included in the annual inspection?
                  </div>
                </div>
                <div className="flex gap-2">
                  <img src="/Julian.jpeg" alt="AI" className="mt-1 h-5 w-5 shrink-0 rounded-full object-cover border border-emerald-400/25" />
                  <div className="rounded-xl rounded-bl-sm border border-zinc-800/60 bg-zinc-950/80 px-3 py-2 text-[12px] leading-relaxed text-zinc-400">
                    Full FAR Part 91 airworthiness check per 14 CFR 43 Appendix D — logbook signoff, discrepancy report, and return-to-service docs included.
                    <span className="mt-1.5 block text-emerald-400/70">Annual Inspection — $850 →</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   CALCULATOR TAB — Fee calculator + Retention ROI
   ═══════════════════════════════════════════════════════════ */
const AVG_TXN_VALUE = 50;
const WHATNOT_COMMISSION = 0.08;
const WHATNOT_STRIPE_PCT = 0.029;
const WHATNOT_STRIPE_FIXED = 0.30;
const COMMONSOLD_COMMISSION = 0.05;
const COMMONSOLD_BASE = 49;
const DUM_CLUB_FLAT = 49;

function formatMoneyPrecise(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function savingsContext(annualSavings: number): string {
  if (annualSavings < 500) return "Enough for a month of paid ads.";
  if (annualSavings < 2000) return "Enough for professional product photography.";
  if (annualSavings < 6000) return "Enough for a new point-of-sale system.";
  if (annualSavings < 12000) return "Enough for a professional website redesign.";
  if (annualSavings < 24000) return "Enough to hire a part-time employee.";
  if (annualSavings < 60000) return "Enough for a full-time hire.";
  return "Enough to open a second location.";
}

function CalculatorTab() {
  const [monthlyGmv, setMonthlyGmv] = useState(10000);
  const [retentionMonth, setRetentionMonth] = useState(3);

  const fees = useMemo(() => {
    const txCount = Math.max(1, Math.round(monthlyGmv / AVG_TXN_VALUE));
    const whatnot = monthlyGmv * WHATNOT_COMMISSION + monthlyGmv * WHATNOT_STRIPE_PCT + txCount * WHATNOT_STRIPE_FIXED;
    const commonsold = monthlyGmv * COMMONSOLD_COMMISSION + COMMONSOLD_BASE;
    const dumClub = DUM_CLUB_FLAT;
    const bestCompetitor = Math.min(whatnot, commonsold);
    const monthlySavings = bestCompetitor - dumClub;
    const annualSavings = monthlySavings * 12;
    return { whatnot, commonsold, dumClub, annualSavings };
  }, [monthlyGmv]);

  const dumCost = 49 * retentionMonth;
  const mailCost = 750 * retentionMonth;
  const saved = mailCost - dumCost;
  const retainedCustomers = Math.round(retentionMonth * 22);
  const repeatRevenue = retainedCustomers * 45;

  return (
    <>
      {/* Fee calculator */}
      <section className="mb-16">
        <div className="rounded-3xl border border-zinc-700/50 bg-zinc-900/60 p-6 backdrop-blur-sm sm:p-10">
          <div className="mb-8 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">Fee calculator</div>
            <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">See what you&apos;d save.</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
              Drag the slider. See what Whatnot and Commonsold take — and what DUM Club charges instead.
            </p>
          </div>

          <div className="mx-auto max-w-2xl">
            <label htmlFor="fee-calc" className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400">
              <span>Your monthly sales</span>
              <span className="font-mono text-sm text-emerald-400">{formatMoneyPrecise(monthlyGmv)}/mo</span>
            </label>
            <input
              id="fee-calc"
              type="range"
              min={1000}
              max={100000}
              step={1000}
              value={monthlyGmv}
              onChange={(e) => setMonthlyGmv(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-700">
              <span>$1k</span><span>$25k</span><span>$50k</span><span>$75k</span><span>$100k</span>
            </div>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-red-500/20 bg-zinc-900/60 p-5 text-center">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Whatnot</div>
              <div className="font-mono text-3xl font-extrabold text-red-400/80">{formatMoneyPrecise(fees.whatnot)}</div>
              <div className="mt-1 text-[10px] text-zinc-500">per month</div>
              <div className="mt-3 text-[11px] text-zinc-400">8% + 2.9% + $0.30/txn</div>
            </div>
            <div className="rounded-2xl border border-red-500/20 bg-zinc-900/60 p-5 text-center">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Commonsold</div>
              <div className="font-mono text-3xl font-extrabold text-red-400/80">{formatMoneyPrecise(fees.commonsold)}</div>
              <div className="mt-1 text-[10px] text-zinc-500">per month</div>
              <div className="mt-3 text-[11px] text-zinc-400">5% per sale + $49 base</div>
            </div>
            <div className="rounded-2xl border-2 border-emerald-400/50 bg-gradient-to-b from-emerald-400/[0.08] to-zinc-900/60 p-5 text-center shadow-[0_0_32px_rgba(0,255,163,0.15)]">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">DUM Club</div>
              <div className="font-mono text-3xl font-extrabold text-emerald-400">{formatMoneyPrecise(fees.dumClub)}</div>
              <div className="mt-1 text-[10px] text-emerald-400/60">flat / month</div>
              <div className="mt-3 text-[11px] text-zinc-300">Growth tier · 0% per sale</div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400">You save</div>
            <div className="mt-2 font-mono text-5xl font-extrabold text-emerald-400 sm:text-6xl">
              {formatMoneyPrecise(fees.annualSavings)}<span className="text-xl font-bold text-emerald-400/70">/year</span>
            </div>
            <p className="mt-3 text-sm text-zinc-300">{savingsContext(fees.annualSavings)}</p>
          </div>

          <div className="mt-8 text-center">
            <Link href="/merchant" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300">
              Start selling — founding merchants join free →
            </Link>
          </div>
        </div>
      </section>

      {/* Retention ROI calculator */}
      <section>
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/80 p-6 sm:p-10">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.35em] text-emerald-400">Customer Retention</div>
          <h2 className="mb-2 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Stop losing customers. <span className="text-emerald-400">Automate repeat business.</span>
          </h2>
          <p className="mb-8 max-w-xl text-sm text-zinc-400">
            DUM Points bring customers back automatically. Our AI retention agent sends reminders, deal pushes, and expiry alerts.
          </p>

          <div className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-4">
              {[
                { step: "1", title: "Customer buys from you", desc: "They earn DUM Points automatically at checkout. No stamps, no cards.", icon: "💳" },
                { step: "2", title: "AI sends them back", desc: "Automated point reminders and deal pushes via email. Zero effort from you.", icon: "🤖" },
                { step: "3", title: "They discover more businesses", desc: "Points work at ANY business on DUM Club. Cross-merchant discovery grows your network.", icon: "🔄" },
                { step: "4", title: "You keep them forever", desc: "The switching cost is high. Points + deals + AI = a loyalty moat no competitor can touch.", icon: "🏆" },
              ].map((s) => (
                <div key={s.step} className="flex gap-4 rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-4 transition hover:border-emerald-400/15">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">{s.icon}</div>
                  <div>
                    <div className="text-[13px] font-bold text-white">{s.title}</div>
                    <div className="mt-0.5 text-[12px] text-zinc-400">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.04] to-zinc-950 p-6">
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">Retention ROI Calculator</div>
              <div className="mb-4">
                <label className="mb-2 block text-[11px] font-bold text-zinc-500">Time period: {retentionMonth} month{retentionMonth > 1 ? "s" : ""}</label>
                <input type="range" min={1} max={12} value={retentionMonth} onChange={(e) => setRetentionMonth(Number(e.target.value))} className="w-full accent-emerald-400" />
                <div className="mt-1 flex justify-between text-[9px] text-zinc-700"><span>1 mo</span><span>6 mo</span><span>12 mo</span></div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div><div className="text-[10px] text-zinc-500">Direct mail cost</div><div className="text-[10px] text-zinc-600">$750/mo avg</div></div>
                  <div className="font-mono text-lg font-bold text-red-400">${mailCost.toLocaleString()}</div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
                  <div><div className="text-[10px] text-emerald-400">DUM Club Growth tier</div><div className="text-[10px] text-emerald-400/50">$49/mo flat</div></div>
                  <div className="font-mono text-lg font-bold text-emerald-400">${dumCost.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4 text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/70">You save</div>
                <div className="font-mono text-3xl font-black text-emerald-400">${saved.toLocaleString()}</div>
                <div className="mt-1 text-[11px] text-zinc-400">~{retainedCustomers} customers retained · ~${repeatRevenue.toLocaleString()} repeat revenue</div>
              </div>
              <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-emerald-400 py-3 text-center text-[13px] font-bold text-black transition hover:bg-emerald-300">
                Start Retaining Customers →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   COMPARE TAB — Whatnot pitch + full comparison table
   ═══════════════════════════════════════════════════════════ */
function CompareTab() {
  return (
    <>
      {/* Whatnot side-by-side */}
      <section className="mb-16">
        <div className="overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.04] to-zinc-950">
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-b border-zinc-800/40 p-8 sm:border-b-0 sm:border-r">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">The Whatnot tax</div>
              <h3 className="mb-4 text-xl font-extrabold text-white sm:text-2xl">
                You sell $10,000/mo on Whatnot.<br />
                <span className="text-red-400">They keep $1,150.</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-red-500/[0.04] px-4 py-2">
                  <span className="text-[12px] text-zinc-400">Platform fee (8%)</span>
                  <span className="font-mono text-[13px] font-bold text-red-400">−$800</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-red-500/[0.04] px-4 py-2">
                  <span className="text-[12px] text-zinc-400">Processing (2.9% + $0.30)</span>
                  <span className="font-mono text-[13px] font-bold text-red-400">−$350</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-zinc-800/40 bg-zinc-900/30 px-4 py-2">
                  <span className="text-[12px] font-bold text-zinc-300">You keep</span>
                  <span className="font-mono text-[14px] font-bold text-zinc-300">$8,850</span>
                </div>
              </div>
            </div>

            <div className="p-8">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">The DUM Club way</div>
              <h3 className="mb-4 text-xl font-extrabold text-white sm:text-2xl">
                Same $10,000/mo.<br />
                <span className="text-emerald-400">You keep $9,951.</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-2">
                  <span className="text-[12px] text-zinc-400">Flat monthly fee</span>
                  <span className="font-mono text-[13px] font-bold text-emerald-400">−$49</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-zinc-800/40 bg-zinc-900/30 px-4 py-2">
                  <span className="text-[12px] text-zinc-400">Commission on sales</span>
                  <span className="font-mono text-[13px] font-bold text-emerald-400">$0</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2">
                  <span className="text-[12px] font-bold text-emerald-300">You keep</span>
                  <span className="font-mono text-[14px] font-bold text-emerald-400">$9,951</span>
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-emerald-400/10 border border-emerald-400/20 p-3 text-center">
                <span className="font-mono text-2xl font-black text-emerald-400">+$1,101</span>
                <span className="ml-2 text-[12px] text-emerald-400/70">more in your pocket every month</span>
              </div>
              <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-emerald-400 py-3 text-center text-[13px] font-bold text-black transition hover:bg-emerald-300">
                Switch from Whatnot — Free →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Full comparison table */}
      <section>
        <div className="mb-8 text-center">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">The real difference</div>
          <h2 className="mx-auto max-w-2xl text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
            Whatnot takes 8%.{" "}
            <span className="text-emerald-400">DUM Club takes $0 per sale.</span>
          </h2>
        </div>

        <div className="mx-auto max-w-4xl overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]" style={{ minWidth: "600px" }}>
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-3 pr-4 text-left text-[9px] uppercase tracking-[0.12em] text-zinc-600"> </th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Whatnot</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Commonsold</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Google Maps</th>
                <th className="px-4 py-3 text-center text-[9px] uppercase tracking-[0.14em] text-emerald-400" style={{ background: "rgba(0,255,135,0.04)", borderRadius: "8px 8px 0 0", border: "1px solid rgba(0,255,135,0.12)", borderBottom: "none" }}>DUM Club</th>
              </tr>
            </thead>
            <tbody>
              {[
                { f: "Fee model", w: "8% + 2.9%", c: "% per sale", g: "Pay for ads", d: "Flat $29–$99/mo" },
                { f: "Per-sale commission", w: "8%", c: "Varies", g: "—", d: "0% ever" },
                { f: "Live selling", w: "Yes", c: "Yes", g: "No", d: "Yes" },
                { f: "Local discovery", w: "No", c: "No", g: "Pay to rank", d: "Free + deals" },
                { f: "Loyalty built in", w: "None", c: "Basic", g: "None", d: "Every tier" },
                { f: "AI retention", w: "None", c: "None", g: "None", d: "Built in" },
                { f: "AI social media", w: "None", c: "None", g: "None", d: "Pro tier" },
                { f: "White-label loyalty", w: "None", c: "None", g: "None", d: "$499/mo+" },
              ].map((row, i) => (
                <tr key={i} className="border-b border-zinc-800/40">
                  <td className="py-3 pr-4 text-[12px] font-medium text-zinc-500" style={{ fontFamily: "'DM Sans', sans-serif" }}>{row.f}</td>
                  <td className="px-3 py-3 text-center text-zinc-600">{row.w}</td>
                  <td className="px-3 py-3 text-center text-zinc-600">{row.c}</td>
                  <td className="px-3 py-3 text-center text-zinc-600">{row.g}</td>
                  <td className="px-4 py-3 text-center font-semibold text-emerald-400" style={{
                    background: "rgba(0,255,135,0.04)",
                    borderLeft: "1px solid rgba(0,255,135,0.12)",
                    borderRight: "1px solid rgba(0,255,135,0.12)",
                    ...(i === 7 ? { borderBottom: "1px solid rgba(0,255,135,0.12)", borderRadius: "0 0 8px 8px" } : {}),
                  }}>{row.d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: "🚫", title: "Zero commission" },
            { icon: "💰", title: "Flat monthly fee" },
            { icon: "🔁", title: "Loyalty built in" },
            { icon: "⚡", title: "Stripe payouts" },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4 text-center transition hover:border-emerald-400/20">
              <div className="mb-2 text-xl">{c.icon}</div>
              <div className="text-[12px] font-bold text-zinc-300">{c.title}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link href="/merchant" className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300">
            Claim Your Free Spot →
          </Link>
        </div>
      </section>
    </>
  );
}
