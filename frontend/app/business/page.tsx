"use client";

/**
 * /business — seller recruitment landing page with sub-tabs.
 *
 * All seller-pitch content lives here — pricing, calculators,
 * competitor comparisons, retention demos. The homepage stays
 * buyer-focused (live sales grid + search). CLAUDE.md v5.0
 * Section 3 pricing is the source of truth for every number.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
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
  return (
    <Suspense fallback={null}>
      <BusinessPageInner />
    </Suspense>
  );
}

function BusinessPageInner() {
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
    <main className="min-h-screen bg-surface-page text-primary">
      {/* ── Hero (always visible) ────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-8 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_top,rgba(0,255,163,0.12),transparent_65%)]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-default bg-brand-teal-soft px-4 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
              {claimed != null ? `${claimed} of ${totalCap} founding spots claimed` : "Founding 100 · spots limited"}
              <span className="ml-2 text-brand-teal">· $0 today · Preferred founding pricing</span>
            </span>
          </div>

          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Keep Everything{" "}
            <span className="text-brand-teal">
              You Earn.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
            Flat monthly fee. 0% commission, always. Founding merchants pay $0 today and receive preferred founding pricing after launch.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/merchant"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
            >
              Claim Your Free Spot →
            </Link>
            <Link
              href="/discover"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-default bg-surface-card px-8 py-4 text-sm font-bold text-primary transition hover:border-default hover:text-brand-teal"
            >
              See the Marketplace
            </Link>
          </div>
        </div>
      </section>

      {/* ── Sub-tab navigation ───────────────────────── */}
      <div className="sticky top-16 z-30 border-b border-default bg-surface-card/95 lg:top-20 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 border-b-2 px-5 py-3.5 text-[12px] font-bold uppercase tracking-[0.15em] transition ${
                activeTab === tab.id
                  ? "border-brand-teal text-brand-teal"
                  : "border-transparent text-secondary hover:text-primary"
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
      <section className="border-t border-default px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-3xl border border-default bg-surface-card p-10 text-center backdrop-blur-sm">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
            Questions?
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
            Talk to Julian.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-secondary">
            I built DUM Club. I also run Topgun Maintenance LLC, the founding merchant. Email or call me directly — I&apos;ll get back same day.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
            <a
              href="mailto:julian@topgunmaintenance.com"
              className="font-mono text-sm text-brand-teal transition hover:text-brand-teal"
            >
              julian@topgunmaintenance.com
            </a>
            <span className="hidden text-muted sm:inline">·</span>
            <a
              href="tel:+12014521986"
              className="font-mono text-sm text-brand-teal transition hover:text-brand-teal"
            >
              +1 (201) 452-1986
            </a>
          </div>
        </div>
      </section>

      <div className="border-t border-default px-4 py-10 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">
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
      {/* Fee comparison cards — five expense lines collapsed into one */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
            One flat fee instead of five
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">
            Replace five expense lines with one.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-secondary">
            Local businesses already pay for delivery apps, live selling, loyalty, retention, and deal platforms. DUM Club replaces all five with one flat monthly fee.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { name: "Delivery apps", fees: "15–30%", detail: "of every order", muted: true },
            { name: "Live selling", fees: "8% + fees", detail: "per sale", muted: true },
            { name: "Loyalty software", fees: "$50–$300", detail: "per month", muted: true },
            { name: "SMS retention", fees: "$20–$200", detail: "per month", muted: true },
            { name: "DUM Club", fees: "$29–$99", detail: "flat / month · 0% commission", muted: false },
          ].map((p) => (
            <div
              key={p.name}
              className={`rounded-2xl border p-5 text-center backdrop-blur-sm transition ${
                p.muted
                  ? "border-red-500/15 bg-surface-card"
                  : "border-2 border-brand-teal bg-gradient-to-b from-brand-teal-soft to-surface-muted"
              }`}
            >
              <div className={`mb-2 text-[10px] font-bold uppercase tracking-[0.18em] ${p.muted ? "text-secondary" : "text-brand-teal"}`}>
                {p.name}
              </div>
              <div className={`font-mono text-2xl font-extrabold ${p.muted ? "text-state-live/80" : "text-brand-teal"}`}>
                {p.fees}
              </div>
              <div className="mt-2 text-[11px] text-secondary">{p.detail}</div>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-primary">
          One bill, no commissions —{" "}
          <span className="font-bold text-brand-teal">keep everything you earn.</span>
        </p>
      </section>

      {/* How it works — 3 steps */}
      <section className="mb-16">
        <div className="rounded-3xl border border-default bg-surface-muted px-8 py-12 backdrop-blur-sm sm:px-12 sm:py-16">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-brand-teal">How it works</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">
            Why local businesses choose DUM Club.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-primary sm:text-lg">
            One flat fee. Zero commission. Customers who come back.
          </p>
          <div className="mt-12 grid gap-3 sm:grid-cols-3">
            {[
              { n: "01", title: "No commission on any sale", desc: "Marketplaces and delivery apps take 8–30% of every order. We charge $29–$99/month. Flat fee. 0% commission, always. Founding merchant pricing for the first 100." },
              { n: "02", title: "Stripe pays you direct", desc: "Connect Stripe once. Every sale hits your bank — not our account first, not a platform wallet." },
              { n: "03", title: "Customers come back automatically", desc: "DUM Points and AI retention bring one-time buyers back. Replaces the loyalty + SMS tools you're already paying for." },
            ].map((step) => (
              <div
                key={step.n}
                className="group relative overflow-hidden rounded-xl border border-default bg-surface-card p-6 backdrop-blur-sm transition hover:border-default"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-default bg-brand-teal-soft font-mono text-sm font-extrabold text-brand-teal">
                  {step.n}
                </div>
                <div className="mt-3 text-base font-bold text-primary">{step.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-primary">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="mb-16">
        <div className="mb-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">Every tier includes</div>
          <h2 className="text-3xl font-extrabold tracking-tight text-primary sm:text-4xl">The basics come standard.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { title: "DUM Points loyalty", desc: "Customers earn points on every purchase. Redeemable at any DUM Club seller — the loyalty network that makes them come back." },
            { title: "Stripe direct payouts", desc: "Money goes straight to your bank via Stripe Connect. No marketplace holding your funds. No payout delays." },
            { title: "Storefront on the marketplace", desc: "A real buyable page with your offers, photos, and Stripe checkout. Shareable anywhere." },
            { title: "AI sales assistant", desc: "A customer-facing chatbot that answers questions using your real offer data. Helps close sales 24/7." },
            { title: "Listed on /discover", desc: "The marketplace browse page with search, live streaming, and local discovery. Free organic traffic." },
            { title: "Founding merchant badge", desc: "Permanent badge on your profile if you join the founding 100. Recognised as one of the first sellers on the network." },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-default bg-surface-card p-5 backdrop-blur-sm transition hover:border-default">
              <div className="mb-2 text-sm font-bold text-primary">{item.title}</div>
              <p className="text-[13px] leading-relaxed text-secondary">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Founding 100 */}
      <section>
        <div className="rounded-3xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-10 text-center">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">Limited · Founding 100</div>
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-primary sm:text-4xl">
            The first 100 merchants get in free.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm text-secondary">
            $0 during the founding period. Preferred founding pricing after launch. Founding merchant badge permanent on your profile.
          </p>
          <div className="mt-8 inline-flex items-baseline gap-3 rounded-2xl border border-default bg-surface-card px-6 py-4 backdrop-blur-sm">
            <span className="font-mono text-4xl font-extrabold text-brand-teal">
              {claimed != null ? claimed : "—"}
            </span>
            <span className="text-xs uppercase tracking-[0.2em] text-secondary">of {totalCap} founding spots claimed</span>
          </div>
          <div className="mt-8">
            <Link
              href="/merchant"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
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
  // Phase 12: pricing now lives at /pricing as a real, indexable
  // route. Keep this sub-tab as a redirect-card (vs an in-place
  // duplicate of the same tier grid) so there's a single source
  // of truth for tier numbers and FAQ content.
  return (
    <section className="mx-auto max-w-2xl">
      <Link
        href="/pricing"
        className="group block rounded-2xl border border-default bg-surface-card p-8 text-center shadow-sm transition-all hover:border-strong hover:shadow-md"
      >
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
          Pricing
        </div>
        <h2 className="mb-3 text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
          Flat $29–$99/month. <span className="text-brand-navy">0% commission.</span>
        </h2>
        <p className="mx-auto mb-6 max-w-md text-sm text-secondary">
          Tier comparison, Whatnot vs DUM at $10k GMV, FAQ, and the Talk-to-Julian
          rail all live on the dedicated pricing page.
        </p>
        <span className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-brand-navy transition group-hover:bg-brand-teal-hover group-hover:text-white">
          See full pricing →
        </span>
      </Link>
    </section>
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
        <div className="rounded-3xl border border-default bg-surface-card p-6 backdrop-blur-sm sm:p-10">
          <div className="mb-8 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">Fee calculator</div>
            <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">See what you&apos;d save.</h2>
            <p className="mx-auto mt-2 max-w-lg text-sm text-secondary">
              Drag the slider. See what Whatnot and Commonsold take — and what DUM Club charges instead.
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
              <div className="mt-3 text-[11px] text-secondary">8% + 2.9% + $0.30/txn</div>
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
              <div className="mt-1 text-[10px] text-brand-teal/60">flat / month</div>
              <div className="mt-3 text-[11px] text-primary">Growth tier · 0% per sale</div>
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
              Start selling — founding merchants join free →
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
                  <div><div className="text-[10px] text-brand-teal">DUM Club Growth tier</div><div className="text-[10px] text-brand-teal/50">$49/mo flat</div></div>
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
        <div className="overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.04] to-surface-card">
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-b border-default p-8 sm:border-b-0 sm:border-r">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-state-live">The Whatnot tax</div>
              <h3 className="mb-4 text-xl font-extrabold text-primary sm:text-2xl">
                You sell $10,000/mo on Whatnot.<br />
                <span className="text-state-live">They keep $1,150.</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-state-live/[0.04] px-4 py-2">
                  <span className="text-[12px] text-secondary">Platform fee (8%)</span>
                  <span className="font-mono text-[13px] font-bold text-state-live">−$800</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-state-live/[0.04] px-4 py-2">
                  <span className="text-[12px] text-secondary">Processing (2.9% + $0.30)</span>
                  <span className="font-mono text-[13px] font-bold text-state-live">−$350</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-surface-muted px-4 py-2">
                  <span className="text-[12px] font-bold text-primary">You keep</span>
                  <span className="font-mono text-[14px] font-bold text-primary">$8,850</span>
                </div>
              </div>
            </div>

            <div className="p-8">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">The DUM Club way</div>
              <h3 className="mb-4 text-xl font-extrabold text-primary sm:text-2xl">
                Same $10,000/mo.<br />
                <span className="text-brand-teal">You keep $9,951.</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft px-4 py-2">
                  <span className="text-[12px] text-secondary">Flat monthly fee</span>
                  <span className="font-mono text-[13px] font-bold text-brand-teal">−$49</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-surface-muted px-4 py-2">
                  <span className="text-[12px] text-secondary">Commission on sales</span>
                  <span className="font-mono text-[13px] font-bold text-brand-teal">$0</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft px-4 py-2">
                  <span className="text-[12px] font-bold text-brand-teal">You keep</span>
                  <span className="font-mono text-[14px] font-bold text-brand-teal">$9,951</span>
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-brand-teal-soft border border-default p-3 text-center">
                <span className="font-mono text-2xl font-black text-brand-teal">+$1,101</span>
                <span className="ml-2 text-[12px] text-brand-teal">more in your pocket every month</span>
              </div>
              <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-brand-teal py-3 text-center text-[13px] font-bold text-black transition hover:bg-brand-teal-hover">
                Switch from Whatnot — Free →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Full comparison table */}
      <section>
        <div className="mb-8 text-center">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-brand-teal">The real difference</div>
          <h2 className="mx-auto max-w-2xl text-2xl font-extrabold leading-tight tracking-tight text-primary sm:text-3xl">
            Whatnot takes 8%.{" "}
            <span className="text-brand-teal">DUM Club takes $0 per sale.</span>
          </h2>
        </div>

        <div className="mx-auto max-w-4xl overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]" style={{ minWidth: "600px" }}>
            <thead>
              <tr className="border-b border-default">
                <th className="py-3 pr-4 text-left text-[9px] uppercase tracking-[0.12em] text-muted"> </th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-muted">Whatnot</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-muted">Commonsold</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-muted">Google Maps</th>
                <th className="px-4 py-3 text-center text-[9px] uppercase tracking-[0.14em] text-brand-teal" style={{ background: "rgba(0,255,135,0.04)", borderRadius: "8px 8px 0 0", border: "1px solid rgba(0,255,135,0.12)", borderBottom: "none" }}>DUM Club</th>
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
                <tr key={i} className="border-b border-default">
                  <td className="py-3 pr-4 text-[12px] font-medium text-secondary" style={{ fontFamily: "'DM Sans', sans-serif" }}>{row.f}</td>
                  <td className="px-3 py-3 text-center text-muted">{row.w}</td>
                  <td className="px-3 py-3 text-center text-muted">{row.c}</td>
                  <td className="px-3 py-3 text-center text-muted">{row.g}</td>
                  <td className="px-4 py-3 text-center font-semibold text-brand-teal" style={{
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
            <div key={c.title} className="rounded-xl border border-default bg-surface-card p-4 text-center transition hover:border-default">
              <div className="mb-2 text-xl">{c.icon}</div>
              <div className="text-[12px] font-bold text-primary">{c.title}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link href="/merchant" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover">
            Claim Your Free Spot →
          </Link>
        </div>
      </section>
    </>
  );
}
