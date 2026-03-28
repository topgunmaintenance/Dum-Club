"use client";

import Link from "next/link";

const FREE_FEATURES = [
  "5 launches per day",
  "Standard AI generation",
  "Dashboard & project tools",
  "Community discovery feed",
  "Public project page",
];

const PRO_FEATURES = [
  "25 launches per day",
  "Priority AI generation",
  "Featured project eligibility",
  "Advanced dashboard analytics",
  "Early access to new tools",
  "Priority support",
];

const BUILDER_FEATURES = [
  "Unlimited launches",
  "Fastest AI generation",
  "Guaranteed featured placement",
  "Full analytics + token insights",
  "Earliest access to everything",
  "Dedicated creator support",
  "Custom token branding",
];

function Check() {
  return (
    <svg className="h-4 w-4 shrink-0 text-emerald-400" fill="none" viewBox="0 0 16 16">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" />
    </svg>
  );
}

export default function UpgradePage() {
  return (
    <div className="min-h-screen bg-black px-4 py-20 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">

        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">
            ◆ Creator Access
          </div>
          <h1 className="mt-6 font-mono text-5xl font-black uppercase leading-tight tracking-[-0.03em] text-white sm:text-6xl">
            Build more.<br />
            <span className="text-emerald-400">Launch faster.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
            Serious builders don&apos;t wait for their idea quota to reset.
            Upgrade your access and keep the momentum going.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="mt-16 grid gap-6 sm:grid-cols-3">

          {/* Free */}
          <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">Free</div>
            <div className="mt-4 flex items-end gap-1">
              <span className="text-4xl font-black text-white">$0</span>
              <span className="mb-1 text-sm text-zinc-600">/mo</span>
            </div>
            <p className="mt-3 text-sm text-zinc-500">Get started and prove your idea has legs.</p>
            <ul className="mt-8 flex-1 space-y-3">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-zinc-400">
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-xl border border-zinc-700 px-5 py-3 text-center text-sm font-semibold text-zinc-500">
              Current plan
            </div>
          </div>

          {/* Pro — recommended */}
          <div className="relative flex flex-col rounded-2xl border border-emerald-400/40 bg-zinc-950 p-8 shadow-[0_0_40px_-12px] shadow-emerald-500/20">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="rounded-full bg-emerald-400 px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                Most popular
              </span>
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-400">Pro</div>
            <div className="mt-4 flex items-end gap-1">
              <span className="text-4xl font-black text-white">$19</span>
              <span className="mb-1 text-sm text-zinc-400">/mo</span>
            </div>
            <p className="mt-3 text-sm text-zinc-400">For builders who ship ideas faster than most people plan.</p>
            <ul className="mt-8 flex-1 space-y-3">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-zinc-300">
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-8 w-full rounded-xl bg-emerald-400 px-5 py-3.5 font-mono text-sm font-bold uppercase tracking-[0.15em] text-black transition hover:bg-emerald-300"
              onClick={() => alert("Payment coming soon — you'll be first to know.")}
            >
              Upgrade to Pro
            </button>
          </div>

          {/* Builder */}
          <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-8">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-purple-400">Builder</div>
            <div className="mt-4 flex items-end gap-1">
              <span className="text-4xl font-black text-white">$49</span>
              <span className="mb-1 text-sm text-zinc-600">/mo</span>
            </div>
            <p className="mt-3 text-sm text-zinc-500">For creators running multiple projects and chasing serious traction.</p>
            <ul className="mt-8 flex-1 space-y-3">
              {BUILDER_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-zinc-400">
                  <Check />
                  {f}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-8 w-full rounded-xl border border-purple-500/50 bg-purple-500/10 px-5 py-3.5 font-mono text-sm font-bold uppercase tracking-[0.15em] text-purple-300 transition hover:border-purple-400 hover:bg-purple-500/20"
              onClick={() => alert("Payment coming soon — you'll be first to know.")}
            >
              Upgrade to Builder
            </button>
          </div>
        </div>

        {/* Earn your upgrade */}
        <div className="mt-20 rounded-2xl border border-zinc-800 bg-zinc-950 px-8 py-12 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <div className="font-mono text-[10px] uppercase tracking-[0.35em] text-emerald-400">
              ◆ Earn it
            </div>
            <h2 className="mt-4 font-mono text-3xl font-black uppercase leading-tight text-white sm:text-4xl">
              Traction unlocks access.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-zinc-400">
              If your project gets real traction — token holders, trading volume,
              community activity — your launch limits increase automatically.
              No payment required.
            </p>
            <p className="mt-4 text-sm text-zinc-500">
              We reward builders who prove demand. That&apos;s the whole point.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { milestone: "50 token trades", reward: "Limit increases" },
                { milestone: "$100 volume", reward: "Featured eligibility" },
                { milestone: "25 holders", reward: "Pro-tier access" },
              ].map(({ milestone, reward }) => (
                <div key={milestone} className="rounded-xl border border-zinc-800 bg-black px-5 py-6">
                  <div className="font-mono text-sm font-bold text-white">{milestone}</div>
                  <div className="mt-2 text-xs text-emerald-400">{reward}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Trust / footer note */}
        <div className="mt-16 text-center">
          <p className="text-sm text-zinc-600">
            Payments coming soon. Join the waitlist by trying to upgrade — we&apos;ll
            notify you when billing goes live.
          </p>
          <Link
            href="/build"
            className="mt-4 inline-block text-sm text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline"
          >
            ← Back to builder
          </Link>
        </div>

      </div>
    </div>
  );
}
