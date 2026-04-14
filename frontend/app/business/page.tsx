"use client";

/**
 * /business — seller recruitment landing page.
 *
 * This is the page we send to Whatnot/Commonsold sellers and local
 * business owners to convince them to switch. Flat fee, zero
 * commission, founding-100 free tier. Built to match the dark
 * emerald aesthetic of the rest of the site. CLAUDE.md v5.0
 * Section 3 pricing is the source of truth for every number below.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_BASE } from "../../lib/apiBase";

type FoundingStatus = {
  founding_slots_remaining: number;
  total_cap: number;
  founding_program_open: boolean;
};

export default function BusinessPage() {
  const [founding, setFounding] = useState<FoundingStatus | null>(null);

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

  return (
    <main className="min-h-screen bg-[#060606] text-white">
      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:pt-32">
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
              Founding 100 · {slotsRemaining != null ? `${slotsRemaining} spots left` : "spots limited"}
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

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
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

          <p className="mt-6 text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600">
            Stripe checkout · 0% commission · Live in 60 seconds
          </p>
        </div>
      </section>

      {/* ── Fee comparison cards ──────────────────────── */}
      <section className="mx-auto max-w-6xl px-4 py-16">
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
              className={`rounded-2xl border p-6 text-center transition ${
                p.muted
                  ? "border-zinc-800/60 bg-zinc-950/60"
                  : "border-emerald-400/30 bg-emerald-400/[0.04] shadow-[0_0_32px_rgba(0,255,163,0.08)]"
              }`}
            >
              <div
                className={`mb-2 text-[10px] font-bold uppercase tracking-[0.2em] ${
                  p.muted ? "text-zinc-500" : "text-emerald-400"
                }`}
              >
                {p.name}
              </div>
              <div
                className={`font-mono text-3xl font-extrabold ${
                  p.muted ? "text-zinc-400" : "text-emerald-400"
                }`}
                style={p.muted ? undefined : { textShadow: "0 0 24px rgba(0,255,163,0.35)" }}
              >
                {p.fees}
              </div>
              <div className="mt-2 text-[11px] text-zinc-500">{p.detail}</div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-zinc-400">
          Sell $10,000 or $100,000 a month —{" "}
          <span className="font-bold text-emerald-400">your fee never changes.</span>
        </p>
      </section>

      {/* ── Tier cards ───────────────────────────────────── */}
      <section className="border-t border-zinc-900 px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
              Pricing
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Pick the tier that fits.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">
              Every tier includes DUM Points loyalty, Stripe direct payouts, and zero commission. Upgrade anytime. Founding merchants pay $0 during the founding period.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                name: "Starter",
                price: "$29",
                tagline: "Everything you need to sell",
                features: [
                  "Storefront on the marketplace",
                  "DUM Points loyalty",
                  "Stripe direct payouts",
                  "Basic sales analytics",
                  "Listed on /discover",
                ],
                highlight: false,
              },
              {
                name: "Growth",
                price: "$49",
                tagline: "Replace your direct mail agency",
                features: [
                  "Everything in Starter",
                  "Featured in category browse",
                  "AI retention agent",
                  "Google reviews on storefront",
                  "Best Deals This Week eligibility",
                ],
                highlight: true,
              },
              {
                name: "Pro",
                price: "$99",
                tagline: "Replace your social media agency",
                features: [
                  "Everything in Growth",
                  "AI social media management",
                  "Homepage featured slot",
                  "Full analytics dashboard",
                  "Priority placement in search",
                ],
                highlight: false,
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-2xl border p-8 transition ${
                  tier.highlight
                    ? "border-emerald-400/40 bg-gradient-to-b from-emerald-400/[0.05] to-zinc-950 shadow-[0_0_32px_rgba(0,255,163,0.08)]"
                    : "border-zinc-800/60 bg-zinc-950/60 hover:border-emerald-400/20"
                }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-emerald-400/50 bg-[#060606] px-3 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">
                    Most Popular
                  </div>
                )}
                <div className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                  {tier.name}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-extrabold text-white">{tier.price}</span>
                  <span className="text-sm text-zinc-500">/month</span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{tier.tagline}</p>
                <ul className="mt-6 space-y-2.5">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-300">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-[10px] font-bold text-emerald-400">
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-[11px] uppercase tracking-[0.2em] text-zinc-600">
            0% commission on every tier · No listing fees · Stripe processing paid by buyer
          </p>
        </div>
      </section>

      {/* ── What's included in every tier ───────────────── */}
      <section className="border-t border-zinc-900 px-4 py-20">
        <div className="mx-auto max-w-4xl">
          <div className="mb-10 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
              Every tier includes
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              The basics come standard.
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                title: "DUM Points loyalty",
                desc: "Customers earn points on every purchase. Redeemable at any DUM Club seller — the loyalty network that makes them come back.",
              },
              {
                title: "Stripe direct payouts",
                desc: "Money goes straight to your bank via Stripe Connect. No marketplace holding your funds. No payout delays.",
              },
              {
                title: "Storefront on the marketplace",
                desc: "A real buyable page at /project/[your-slug] with your offers, photos, and Stripe checkout. Shareable anywhere.",
              },
              {
                title: "AI sales assistant",
                desc: "A customer-facing chatbot that answers questions using your real offer data. Helps close sales 24/7.",
              },
              {
                title: "Listed on /discover",
                desc: "The marketplace browse page with search, live streaming, and local discovery. Free organic traffic.",
              },
              {
                title: "Founding merchant badge",
                desc: "Permanent badge on your profile if you join the founding 100. You locked in early — we don't forget it.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-5 transition hover:border-emerald-400/20"
              >
                <div className="mb-2 text-sm font-bold text-white">{item.title}</div>
                <p className="text-[13px] leading-relaxed text-zinc-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Founding 100 section ────────────────────────── */}
      <section className="border-t border-zinc-900 px-4 py-20">
        <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.08] to-zinc-950 p-10 text-center shadow-[0_0_48px_rgba(0,255,163,0.1)]">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
            Limited · Founding 100
          </div>
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            The first 100 merchants get in free.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-400">
            $0 during the founding period. Locked at $29/month after. Founding merchant badge permanent on your profile. Once 100 slots fill, the program closes and standard tiers apply to everyone new.
          </p>

          <div className="mt-8 inline-flex items-baseline gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 px-6 py-4">
            <span className="font-mono text-4xl font-extrabold text-emerald-400">
              {slotsRemaining != null ? slotsRemaining : "—"}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              of {totalCap} spots remaining
            </span>
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

      {/* ── Talk to Julian CTA ─────────────────────────── */}
      <section className="border-t border-zinc-900 px-4 py-20">
        <div className="mx-auto max-w-2xl rounded-3xl border border-zinc-800/60 bg-zinc-950/80 p-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
            Questions?
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Talk to Julian.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-zinc-400">
            I built DUM Club. I also run Topgun Maintenance LLC, the founding merchant. Email or call me directly — I'll get back same day.
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

      {/* ── Bottom footer strip ────────────────────────── */}
      <div className="border-t border-zinc-900 px-4 py-10 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-700">
          Stripe-powered payments · 0% commission · Founding 100 · DUM Club v5.0
        </p>
      </div>
    </main>
  );
}
