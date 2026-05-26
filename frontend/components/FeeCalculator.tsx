"use client";

/**
 * FeeCalculator. interactive fee savings calculator for the homepage.
 *
 * A slider between $1k and $100k monthly GMV, showing what Whatnot and
 * Commonsold would take vs DUM Club's flat Growth-tier fee ($99/mo).
 * The savings number is the headline; a contextual "that's enough to..."
 * line anchors it emotionally. CTA drops into /merchant.
 *
 * Fee math (all comparisons to CLAUDE.md v5.0 Section 11):
 *   Whatnot:    8% of GMV + 2.9% of GMV + $0.30 per txn
 *               Assumes average transaction value of $50 to compute txn count.
 *   Commonsold: 5% of GMV + $49/mo base
 *   DUM Club:   $99/mo Growth tier flat + 1% sales fee on GMV.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

const AVG_TXN_VALUE = 50;          // USD
const WHATNOT_COMMISSION = 0.08;   // 8%
const WHATNOT_STRIPE_PCT = 0.029;  // 2.9%
const WHATNOT_STRIPE_FIXED = 0.30; // $0.30
const COMMONSOLD_COMMISSION = 0.05; // 5%
const COMMONSOLD_BASE = 49;
const DUM_CLUB_FLAT = 99;          // Growth tier subscription
const DUM_CLUB_SALES_FEE = 0.01;   // 1% platform sales fee per order

function formatMoney(n: number): string {
  if (n >= 10000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function formatMoneyPrecise(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Pick a contextual "that's enough to..." example based on annual savings.
 * Rough anchors, not precise quotes. these are emotional hooks, not
 * financial guarantees. All comparisons are framed around small-business
 * reinvestment, not lifestyle.
 */
function savingsContext(annualSavings: number): string {
  if (annualSavings < 500) return "Enough for a month of paid ads on top of this.";
  if (annualSavings < 2000) return "Enough for professional product photography.";
  if (annualSavings < 6000) return "Enough for a new point-of-sale system.";
  if (annualSavings < 12000) return "Enough for a professional website redesign.";
  if (annualSavings < 24000) return "Enough to hire a part-time employee.";
  if (annualSavings < 60000) return "Enough for a full-time hire.";
  return "Enough to open a second location.";
}

export function FeeCalculator() {
  const [monthlyGmv, setMonthlyGmv] = useState(10000);

  const fees = useMemo(() => {
    const txCount = Math.max(1, Math.round(monthlyGmv / AVG_TXN_VALUE));

    const whatnot =
      monthlyGmv * WHATNOT_COMMISSION +
      monthlyGmv * WHATNOT_STRIPE_PCT +
      txCount * WHATNOT_STRIPE_FIXED;

    const commonsold = monthlyGmv * COMMONSOLD_COMMISSION + COMMONSOLD_BASE;

    const dumClub = DUM_CLUB_FLAT + monthlyGmv * DUM_CLUB_SALES_FEE;

    // Compare against the cheaper competitor to be conservative on savings.
    const worstCompetitor = Math.max(whatnot, commonsold);
    const bestCompetitor = Math.min(whatnot, commonsold);
    const monthlySavings = bestCompetitor - dumClub;
    const annualSavings = monthlySavings * 12;

    return {
      whatnot,
      commonsold,
      dumClub,
      worstCompetitor,
      bestCompetitor,
      monthlySavings,
      annualSavings,
    };
  }, [monthlyGmv]);

  return (
    <section className="mx-auto mt-10 max-w-4xl px-4">
      <div className="rounded-3xl border border-zinc-700/50 bg-zinc-900/60 p-6 backdrop-blur-sm sm:p-10">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-emerald-400">
            Fee calculator
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            See what you&apos;d save vs Whatnot&apos;s 8% commission.
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-400">
            Drag the slider. DUM Club: $99/mo Growth tier plus a 1% sales fee per order. Whatnot: 8% + 2.9% Stripe on every sale. DUM Club also replaces loyalty, retention, and deal-platform tools, all in the same subscription.
          </p>
        </div>

        {/* Slider */}
        <div className="mx-auto max-w-2xl">
          <label
            htmlFor="fee-calc-slider"
            className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-400"
          >
            <span>Your monthly sales</span>
            <span className="font-mono text-sm text-emerald-400">
              {formatMoneyPrecise(monthlyGmv)}/mo
            </span>
          </label>
          <input
            id="fee-calc-slider"
            type="range"
            min={1000}
            max={100000}
            step={1000}
            value={monthlyGmv}
            onChange={(e) => setMonthlyGmv(Number(e.target.value))}
            aria-label="Your monthly sales in dollars"
            className="fee-calc-slider w-full"
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-zinc-700">
            <span>$1k</span>
            <span>$25k</span>
            <span>$50k</span>
            <span>$75k</span>
            <span>$100k</span>
          </div>
        </div>

        {/* Result columns */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {/* Whatnot */}
          <div className="rounded-2xl border border-red-500/20 bg-zinc-900/60 p-5 text-center backdrop-blur-sm">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
              Whatnot
            </div>
            <div className="font-mono text-3xl font-extrabold text-red-400/80">
              {formatMoneyPrecise(fees.whatnot)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">per month</div>
            <div className="mt-3 text-[11px] text-zinc-400">
              8% + 2.9% + $0.30/txn
            </div>
          </div>

          {/* Commonsold */}
          <div className="rounded-2xl border border-red-500/20 bg-zinc-900/60 p-5 text-center backdrop-blur-sm">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
              Commonsold
            </div>
            <div className="font-mono text-3xl font-extrabold text-red-400/80">
              {formatMoneyPrecise(fees.commonsold)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">per month</div>
            <div className="mt-3 text-[11px] text-zinc-400">
              5% per sale + $49 base
            </div>
          </div>

          {/* DUM Club */}
          <div className="rounded-2xl border-2 border-emerald-400/50 bg-gradient-to-b from-emerald-400/[0.08] to-zinc-900/60 p-5 text-center shadow-[0_0_32px_rgba(0,255,163,0.15)] backdrop-blur-sm">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
              DUM Club ★
            </div>
            <div className="neon-emerald font-mono text-3xl font-extrabold text-emerald-400">
              {formatMoneyPrecise(fees.dumClub)}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-emerald-400/60">total / month</div>
            <div className="mt-3 text-[11px] text-zinc-300">
              $99 Growth tier + 1% per sale
            </div>
          </div>
        </div>

        {/* Savings headline */}
        <div className="mt-10 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-400">
            You save
          </div>
          <div className="neon-emerald-strong mt-2 font-mono text-6xl font-extrabold text-emerald-400 sm:text-7xl">
            {formatMoneyPrecise(fees.annualSavings)}
            <span className="text-xl font-bold text-emerald-400/70">/year</span>
          </div>
          <p className="mt-3 text-sm text-zinc-300">
            {savingsContext(fees.annualSavings)}
          </p>
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          <Link
            href="/merchant"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_32px_rgba(0,255,163,0.2)] transition hover:bg-emerald-300 hover:shadow-[0_0_48px_rgba(0,255,163,0.35)]"
          >
            Claim Your Founding Spot →
          </Link>
          <p className="mt-3 text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-500">
            Founding merchants · 60 days free · Lock in founding pricing for life
          </p>
        </div>
      </div>

      {/* Slider styling. scoped via a className, styled here with plain
          CSS in a <style jsx>. Matches the site's emerald palette. */}
      <style jsx>{`
        .fee-calc-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 6px;
          border-radius: 999px;
          background: linear-gradient(
            to right,
            rgba(0, 255, 163, 0.6) 0%,
            rgba(0, 255, 163, 0.6) ${((monthlyGmv - 1000) / (100000 - 1000)) * 100}%,
            rgba(39, 39, 42, 0.8) ${((monthlyGmv - 1000) / (100000 - 1000)) * 100}%,
            rgba(39, 39, 42, 0.8) 100%
          );
          outline: none;
        }
        .fee-calc-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #00ffa3;
          cursor: pointer;
          box-shadow: 0 0 12px rgba(0, 255, 163, 0.5);
          border: 2px solid #060606;
          transition: transform 0.12s ease;
        }
        .fee-calc-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
        .fee-calc-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #00ffa3;
          cursor: pointer;
          box-shadow: 0 0 12px rgba(0, 255, 163, 0.5);
          border: 2px solid #060606;
          transition: transform 0.12s ease;
        }
        .fee-calc-slider::-moz-range-thumb:hover {
          transform: scale(1.1);
        }
      `}</style>
    </section>
  );
}
