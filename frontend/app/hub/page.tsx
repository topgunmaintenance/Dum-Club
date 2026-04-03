"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { Starfield } from "../../components/Starfield";

const TIERS = [
  { name: "Starter", min: 0, color: "#666" },
  { name: "Builder", min: 50, color: "#00FF87" },
  { name: "Operator", min: 100, color: "#F5A623" },
  { name: "Major", min: 1000, color: "#4F9EFF" },
];

function getTier(pts: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (pts >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[0];
}

function getNextTier(pts: number) {
  for (const t of TIERS) {
    if (pts < t.min) return t;
  }
  return null;
}

export default function HubPage() {
  const { user, login } = useAuth();
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    const read = () => setBalance(Number(localStorage.getItem("dum_points") || "0"));
    read();
    window.addEventListener("dum-points-update", read);
    return () => window.removeEventListener("dum-points-update", read);
  }, []);

  const tier = getTier(balance);
  const next = getNextTier(balance);
  const progressPct = next ? Math.min((balance / next.min) * 100, 100) : 100;

  if (!user) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center bg-base px-4 text-white">
        <Starfield count={60} />
        <div className="relative z-10 max-w-md text-center">
          <div className="mb-4 text-4xl">◆</div>
          <h1 className="text-2xl font-black tracking-tight">DUM Hub</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Sign in to view your DUM Points balance, earn rewards, and unlock discounts across DUM Club.
          </p>
          <button
            onClick={() => login()}
            className="mt-6 w-full rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300"
          >
            Sign In to Continue →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-base text-white">
      <Starfield count={60} />

      <div className="relative z-10 mx-auto max-w-2xl px-4 py-16">
        {/* Header */}
        <div className="mb-10 text-center">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-400/60">
            DUM Hub · Powered by Solana
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            Your DUM Points
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Earn rewards. Unlock discounts. Use them at any business on DUM Club.
          </p>
        </div>

        {/* ── SECTION 1: Balance ── */}
        <div className="mb-6 rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">
                Balance
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-5xl font-black text-white">{balance}</span>
                <span className="text-lg text-zinc-500">points</span>
              </div>
            </div>
            <div className="text-right">
              <div
                className="rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em]"
                style={{ borderColor: tier.color, color: tier.color }}
              >
                {tier.name}
              </div>
            </div>
          </div>

          {/* Tier progress */}
          {next && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-[10px]">
                <span className="text-zinc-500">Progress to {next.name}</span>
                <span className="font-mono text-zinc-400">{balance} / {next.min}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${progressPct}%`, background: next.color }}
                />
              </div>
            </div>
          )}
          {!next && (
            <div className="mt-4 text-[11px] text-emerald-400/70">
              ✓ Maximum tier reached
            </div>
          )}
        </div>

        {/* ── SECTION 2: How to Earn ── */}
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            How to Earn
          </div>
          <div className="space-y-3">
            {[
              { icon: "🛒", points: "+2", label: "Every purchase you make" },
              { icon: "🏪", points: "+25", label: "Every business you create" },
              { icon: "📦", points: "+5", label: "Every offer you add to your storefront" },
              { icon: "🔁", points: "+2", label: "When customers buy from your business" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-4">
                <span className="text-lg">{item.icon}</span>
                <span className="w-10 text-right font-mono text-sm font-bold text-emerald-400">{item.points}</span>
                <span className="text-sm text-zinc-400">{item.label}</span>
              </div>
            ))}
          </div>
          <Link
            href="/discover"
            className="mt-5 flex w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-[12px] font-bold text-zinc-300 transition hover:border-emerald-400/20 hover:text-emerald-400"
          >
            Browse businesses to start earning →
          </Link>
        </div>

        {/* ── SECTION 3: How to Spend ── */}
        <div className="mb-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            How to Spend
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">
                %
              </div>
              <div>
                <div className="text-sm font-bold text-white">10% off any offer</div>
                <div className="text-[12px] text-zinc-500">Use 10 DUM Points at checkout for an instant 10% discount on any offer, at any business.</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">
                🌐
              </div>
              <div>
                <div className="text-sm font-bold text-white">Works everywhere</div>
                <div className="text-[12px] text-zinc-500">DUM Points are not tied to one business. Earn at any storefront, spend at any storefront.</div>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/10 text-lg">
                ⬆
              </div>
              <div>
                <div className="text-sm font-bold text-white">Higher tiers, more perks</div>
                <div className="text-[12px] text-zinc-500">As your points grow, you unlock higher tiers with priority placement, more AI access, and exclusive features.</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Tiers overview ── */}
        <div className="mb-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Tiers
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TIERS.map((t) => {
              const active = tier.name === t.name;
              return (
                <div
                  key={t.name}
                  className={`rounded-xl border p-4 text-center transition ${
                    active
                      ? "border-emerald-400/30 bg-emerald-400/[0.04]"
                      : "border-zinc-800 bg-zinc-900/30"
                  }`}
                >
                  <div
                    className="mb-1 text-lg font-black"
                    style={{ color: active ? t.color : "#555" }}
                  >
                    {t.min === 0 ? "0" : t.min.toLocaleString()}+
                  </div>
                  <div
                    className="text-[11px] font-bold uppercase tracking-[0.1em]"
                    style={{ color: active ? t.color : "#666" }}
                  >
                    {t.name}
                  </div>
                  {active && (
                    <div className="mt-1 text-[9px] text-emerald-400/60">Current</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CTAs ── */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/build"
            className="flex flex-1 items-center justify-center rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300"
          >
            Start Selling →
          </Link>
          <Link
            href="/discover"
            className="flex flex-1 items-center justify-center rounded-xl border border-zinc-700 px-6 py-3.5 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
          >
            Browse Businesses
          </Link>
        </div>
      </div>
    </div>
  );
}
