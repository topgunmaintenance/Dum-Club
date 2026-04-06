"use client";

import Link from "next/link";
import { Starfield } from "../../components/Starfield";

const TIERS = [
  {
    name: "Free",
    requirement: "No points needed",
    color: "text-zinc-400",
    borderColor: "border-zinc-800",
    features: [
      "5 project launches",
      "5 AI questions per project",
      "Basic storefront",
      "Community discovery",
      "Stripe payments",
    ],
    cta: null,
  },
  {
    name: "Supporter",
    requirement: "Hold 100 DUM",
    color: "text-emerald-400",
    borderColor: "border-emerald-400/40",
    highlight: true,
    features: [
      "Unlimited AI questions",
      "Supporter badge on profile",
      "Priority in Discover",
      "10% off creator offers",
      "Everything in Free",
    ],
    cta: "Get DUM Points",
  },
  {
    name: "Pro",
    requirement: "Hold 1,000 DUM",
    color: "text-violet-400",
    borderColor: "border-violet-400/40",
    features: [
      "Unlimited launches",
      "Featured placement",
      "Advanced analytics",
      "Custom storefront branding",
      "Everything in Supporter",
    ],
    cta: "Get DUM Points",
  },
  {
    name: "Partner",
    requirement: "Hold 10,000 DUM",
    color: "text-amber-400",
    borderColor: "border-amber-400/40",
    features: [
      "Revenue share from platform",
      "Governance voting",
      "White-label storefronts",
      "Direct creator support",
      "Everything in Pro",
    ],
    cta: "Get DUM Points",
  },
];

function Check() {
  return (
    <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 16 16">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" />
    </svg>
  );
}

export default function TiersPage() {
  return (
    <div className="relative min-h-screen bg-base px-4 py-20 text-white sm:px-6">
      <Starfield count={50} />
      <div className="relative z-[1] mx-auto max-w-5xl">

        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">
            ◆ DUM Tiers
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Hold DUM.
            <br />
            <span className="text-emerald-400">Unlock more.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
            No subscriptions. No monthly fees. Earn DUM Points to unlock features — the more you earn, the more you can do.
          </p>
        </div>

        {/* Tier cards */}
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl border bg-zinc-950 p-6 ${tier.borderColor} ${
                tier.highlight ? "shadow-[0_0_40px_-12px] shadow-emerald-500/20" : ""
              }`}
            >
              {tier.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-emerald-400 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-black">
                    Recommended
                  </span>
                </div>
              )}
              <div className={`text-[10px] font-bold uppercase tracking-[0.3em] ${tier.color}`}>
                {tier.name}
              </div>
              <div className="mt-3 text-sm font-semibold text-white">
                {tier.requirement}
              </div>
              <ul className="mt-6 flex-1 space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-400">
                    <Check />
                    {f}
                  </li>
                ))}
              </ul>
              {tier.cta ? (
                <Link
                  href="/discover"
                  className={`mt-6 block w-full rounded-xl px-5 py-3 text-center text-sm font-bold transition ${
                    tier.highlight
                      ? "bg-emerald-400 text-black hover:bg-emerald-300"
                      : "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
                  }`}
                >
                  {tier.cta}
                </Link>
              ) : (
                <div className="mt-6 rounded-xl border border-zinc-800 px-5 py-3 text-center text-sm text-zinc-600">
                  Current tier
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Get More DUM Points */}
        <div className="mt-16 rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              Get More DUM Points
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              Add DUM Points to your account. Use them for discounts at every business, game unlocks, AI boosts, and more.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { amount: 50, price: "$4.99", popular: false },
                { amount: 150, price: "$9.99", popular: true },
                { amount: 500, price: "$24.99", popular: false },
              ].map((pkg) => (
                <div key={pkg.amount} className={`relative rounded-xl border p-5 text-center ${pkg.popular ? "border-emerald-400/40 shadow-[0_0_30px_-8px] shadow-emerald-500/20" : "border-zinc-800"}`}>
                  {pkg.popular && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-emerald-400 px-3 py-0.5 text-[8px] font-bold uppercase tracking-widest text-black">Best Value</span>
                    </div>
                  )}
                  <div className="text-3xl font-extrabold text-white">{pkg.amount}</div>
                  <div className="mt-1 text-[11px] text-zinc-500">DUM Points</div>
                  <div className="mt-3 text-lg font-bold text-emerald-400">{pkg.price}</div>
                  <button
                    type="button"
                    onClick={() => { window.location.href = "/hub"; }}
                    className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-bold transition ${pkg.popular ? "bg-emerald-400 text-black hover:bg-emerald-300" : "border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"}`}
                  >
                    Get DUM Points →
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[11px] text-zinc-600">
              Buy DUM Points directly in the DUM Hub, or earn them by building and selling on the platform.
            </p>
          </div>
        </div>

        {/* What DUM Points unlock */}
        <div className="mt-10 grid gap-3 sm:grid-cols-4">
          {[
            { icon: "🏷️", title: "Discounts", desc: "10% off at any business" },
            { icon: "🎮", title: "Game Access", desc: "Unlock unlimited play" },
            { icon: "🚀", title: "Boosts", desc: "Feature your business" },
            { icon: "🤖", title: "AI Power", desc: "Enhanced AI generation" },
          ].map((perk) => (
            <div key={perk.title} className="rounded-xl border border-zinc-800/40 bg-zinc-900/20 p-4 text-center">
              <div className="text-xl">{perk.icon}</div>
              <div className="mt-2 text-sm font-bold text-white">{perk.title}</div>
              <div className="mt-1 text-[11px] text-zinc-500">{perk.desc}</div>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mt-16 rounded-2xl border border-zinc-800 bg-zinc-950 px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold text-white sm:text-3xl">
              How it works
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-zinc-400">
              DUM Points are your membership level. Earn them by building, selling, and using the platform. Your tier activates automatically.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { step: "01", label: "Earn", desc: "Launch projects, make sales, use the platform" },
                { step: "02", label: "Grow", desc: "Your balance grows as you build and sell" },
                { step: "03", label: "Unlock", desc: "Features activate based on your balance" },
              ].map((s) => (
                <div key={s.step} className="rounded-xl border border-zinc-800 bg-base p-5">
                  <div className="font-mono text-lg font-bold text-emerald-400/40">{s.step}</div>
                  <div className="mt-2 text-sm font-bold text-white">{s.label}</div>
                  <div className="mt-1 text-xs text-zinc-500">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="text-sm text-zinc-500 transition hover:text-zinc-300"
          >
            ← Back to home
          </Link>
        </div>

      </div>
    </div>
  );
}
