"use client";

/**
 * SavingsCalculator — fee calculator + retention-ROI calculator.
 *
 * Moved verbatim from /business (CalculatorTab) during the
 * pricing-page consolidation. /pricing is now the single numbers
 * page; /pricing#calculator lands here. CLAUDE.md §3 pricing is
 * the source of truth for every number.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

const AVG_TXN_VALUE = 50;
const WHATNOT_COMMISSION = 0.08;
const WHATNOT_STRIPE_PCT = 0.029;
const WHATNOT_STRIPE_FIXED = 0.30;
const COMMONSOLD_COMMISSION = 0.05;
const COMMONSOLD_BASE = 49;
const DUM_CLUB_FLAT = 39;          // Starter tier subscription
const DUM_CLUB_SALES_FEE = 0.015;   // 1.5% platform sales fee per order (CLAUDE.md §12 cap)

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

export function SavingsCalculator() {
  const [monthlyGmv, setMonthlyGmv] = useState(10000);
  const [retentionMonth, setRetentionMonth] = useState(3);

  const fees = useMemo(() => {
    const txCount = Math.max(1, Math.round(monthlyGmv / AVG_TXN_VALUE));
    const whatnot = monthlyGmv * WHATNOT_COMMISSION + monthlyGmv * WHATNOT_STRIPE_PCT + txCount * WHATNOT_STRIPE_FIXED;
    const commonsold = monthlyGmv * COMMONSOLD_COMMISSION + COMMONSOLD_BASE;
    const dumClub = DUM_CLUB_FLAT + monthlyGmv * DUM_CLUB_SALES_FEE;
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
    <div id="calculator">
      {/* Fee calculator */}
      <section className="mb-16">
        <div className="rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm sm:p-10">
          <div className="mb-8 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">Fee calculator</div>
            <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">See what you&apos;d save.</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-secondary">
              Drag the slider. See what Whatnot and Commonsold take, and what DUM Club charges instead.
            </p>
          </div>

          <div className="mx-auto max-w-2xl">
            <label htmlFor="fee-calc" className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.15em] text-secondary">
              <span>Your monthly sales</span>
              <span className="font-mono text-sm text-brand-teal">{formatMoneyPrecise(monthlyGmv)}/mo</span>
            </label>
            <input
              id="fee-calc"
              type="range"
              min={1000}
              max={100000}
              step={1000}
              value={monthlyGmv}
              onChange={(e) => setMonthlyGmv(Number(e.target.value))}
              className="w-full accent-brand-teal"
            />
            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
              <span>$1k</span><span>$25k</span><span>$50k</span><span>$75k</span><span>$100k</span>
            </div>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-red-500/20 bg-surface-card p-5 text-center">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Whatnot</div>
              <div className="font-mono text-3xl font-extrabold text-state-live/80">{formatMoneyPrecise(fees.whatnot)}</div>
              <div className="mt-1 text-[10px] text-secondary">per month</div>
              <div className="mt-3 text-[11px] text-secondary">Up to 8% + 2.9% + $0.30/txn</div>
            </div>
            <div className="rounded-2xl border border-red-500/20 bg-surface-card p-5 text-center">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Commonsold</div>
              <div className="font-mono text-3xl font-extrabold text-state-live/80">{formatMoneyPrecise(fees.commonsold)}</div>
              <div className="mt-1 text-[10px] text-secondary">per month</div>
              <div className="mt-3 text-[11px] text-secondary">5% per sale + $49 base</div>
            </div>
            <div className="rounded-2xl border-2 border-brand-teal bg-gradient-to-b from-brand-teal-soft to-surface-muted p-5 text-center">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">DUM Club</div>
              <div className="font-mono text-3xl font-extrabold text-brand-teal">{formatMoneyPrecise(fees.dumClub)}</div>
              <div className="mt-1 text-[10px] text-brand-teal/60">total / month</div>
              <div className="mt-3 text-[11px] text-primary">$39 Starter tier + 1.5% per sale</div>
            </div>
          </div>

          <div className="mt-10 text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">You save</div>
            <div className="mt-2 font-mono text-5xl font-extrabold text-brand-teal sm:text-6xl">
              {formatMoneyPrecise(fees.annualSavings)}<span className="text-xl font-bold text-brand-teal">/year</span>
            </div>
            <p className="mt-3 text-sm text-primary">{savingsContext(fees.annualSavings)}</p>
          </div>

          <div className="mt-8 text-center">
            <Link href="/merchant" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover">
              Start Free for 30 Days →
            </Link>
          </div>
        </div>
      </section>

      {/* Retention ROI calculator */}
      <section>
        <div className="rounded-2xl border border-default bg-surface-card p-6 sm:p-10">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.35em] text-brand-teal">Customer Retention</div>
          <h2 className="mb-2 text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
            Stop losing customers. <span className="text-brand-teal">Automate repeat business.</span>
          </h2>
          <p className="mb-8 max-w-xl text-sm text-secondary">
            DUM Points bring customers back automatically. Our automatic customer win-back texts send reminders, deal pushes, and expiry alerts.
          </p>

          <div className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-4">
              {[
                { step: "1", title: "Customer buys from you", desc: "They earn DUM Points automatically at checkout. No stamps, no cards.", icon: "💳" },
                { step: "2", title: "AI sends them back", desc: "Automated point reminders and deal pushes via email. Zero effort from you.", icon: "🤖" },
                { step: "3", title: "They discover more businesses", desc: "Points work at ANY business on DUM Club. Customers can find nearby deals across the whole network.", icon: "🔄" },
                { step: "4", title: "You keep them forever", desc: "The switching cost is high. Points + deals + AI = a loyalty moat no competitor can touch.", icon: "🏆" },
              ].map((s) => (
                <div key={s.step} className="flex gap-4 rounded-xl border border-default bg-surface-muted p-4 transition hover:border-default">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-teal-soft text-lg">{s.icon}</div>
                  <div>
                    <div className="text-[13px] font-bold text-primary">{s.title}</div>
                    <div className="mt-0.5 text-[12px] text-secondary">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-6">
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">Retention ROI Calculator</div>
              <div className="mb-4">
                <label className="mb-2 block text-[11px] font-bold text-secondary">Time period: {retentionMonth} month{retentionMonth > 1 ? "s" : ""}</label>
                <input type="range" min={1} max={12} value={retentionMonth} onChange={(e) => setRetentionMonth(Number(e.target.value))} className="w-full accent-brand-teal" />
                <div className="mt-1 flex justify-between text-[9px] text-muted"><span>1 mo</span><span>6 mo</span><span>12 mo</span></div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-default bg-surface-muted p-3">
                  <div><div className="text-[10px] text-secondary">Direct mail cost</div><div className="text-[10px] text-muted">$750/mo avg</div></div>
                  <div className="font-mono text-lg font-bold text-state-live">${mailCost.toLocaleString()}</div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft p-3">
                  <div><div className="text-[10px] text-brand-teal">DUM Club Growth tier</div><div className="text-[10px] text-brand-teal/50">$99/mo flat</div></div>
                  <div className="font-mono text-lg font-bold text-brand-teal">${dumCost.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-default bg-brand-teal-soft p-4 text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-brand-teal">You save</div>
                <div className="font-mono text-3xl font-black text-brand-teal">${saved.toLocaleString()}</div>
                <div className="mt-1 text-[11px] text-secondary">~{retainedCustomers} customers retained · ~${repeatRevenue.toLocaleString()} repeat revenue</div>
              </div>
              <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-brand-teal py-3 text-center text-[13px] font-bold text-black transition hover:bg-brand-teal-hover">
                Start Retaining Customers →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
