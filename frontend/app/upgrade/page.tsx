"use client";

import Link from "next/link";

const TIERS = [
  {
    name: "Founding 100",
    price: "$0",
    period: "for 60 days",
    afterNote: "Then locked-in founding pricing for life",
    color: "text-brand-teal",
    borderColor: "border-brand-teal",
    highlight: true,
    features: [
      "Storefront on DUM Club marketplace",
      "DUM Points built in automatically",
      "Basic sales analytics",
      "Stripe direct payouts. Keep 100%",
      "Listed on Discover page",
      "Founding seller badge (permanent)",
    ],
    cta: "Claim Your Spot",
    href: "/merchant",
  },
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    afterNote: null,
    color: "text-primary",
    borderColor: "border-default",
    highlight: false,
    features: [
      "Storefront on DUM Club marketplace",
      "DUM Points built in automatically",
      "Basic sales analytics",
      "Stripe direct payouts. Keep 100%",
      "Listed on Discover page",
    ],
    cta: "Get Started",
    href: "/merchant",
  },
  {
    name: "Growth",
    price: "$49",
    period: "/month",
    afterNote: null,
    color: "text-brand-teal",
    borderColor: "border-default",
    highlight: false,
    features: [
      "Everything in Starter",
      "Featured placement in category browse",
      "Automatic customer win-back texts (auto point reminders)",
      "Google review display on storefront",
      "Best Deals This Week eligibility",
    ],
    cta: "Get Started",
    href: "/merchant",
  },
  {
    name: "Pro",
    price: "$99",
    period: "/month",
    afterNote: null,
    color: "text-violet-400",
    borderColor: "border-violet-400/40",
    highlight: false,
    features: [
      "Everything in Growth",
      "AI social media management",
      "Homepage featured slot",
      "Cross-business deal promotions",
      "Full analytics dashboard",
      "Priority placement in search",
    ],
    cta: "Get Started",
    href: "/merchant",
  },
];

function Check() {
  return (
    <svg className="h-4 w-4 shrink-0 text-brand-teal" fill="none" viewBox="0 0 16 16">
      <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <div className="relative min-h-screen bg-surface-page px-4 py-20 text-primary sm:px-6">
      <div className="relative z-[1] mx-auto max-w-5xl">

        {/* Hero */}
        <div className="text-center">
          <div className="inline-flex items-center rounded-full border border-default bg-brand-teal-soft px-4 py-2 font-mono text-[10px] uppercase tracking-[0.35em] text-brand-teal">
            ◆ Pricing
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-brand-navy sm:text-5xl">
            Flat fee.
            <br />
            <span className="text-brand-teal">Zero commission.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-secondary sm:text-lg">
            One monthly price. Keep 100% of every sale. No per-transaction fees, no listing fees, no surprise charges. Ever.
          </p>
        </div>

        {/* Competitor context */}
        <div className="mx-auto mt-8 max-w-xl rounded-xl border border-[var(--state-live)]/30 bg-[var(--state-live)]/10 px-5 py-3 text-center text-sm text-secondary">
          <span className="text-red-400 font-semibold">Whatnot charges 8% + 2.9% per sale.</span>{" "}
          Sell $10k/month and you lose $1,090.
          <span className="text-brand-teal font-semibold"> On DUM Club, you&apos;d pay $29 to $99 flat.</span>
        </div>

        {/* Tier cards */}
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl border bg-surface-card p-6 ${tier.borderColor} ${
                tier.highlight ? "" : ""
              }`}
            >
              {tier.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-brand-teal px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-black">
                    Limited · 100 spots
                  </span>
                </div>
              )}
              <div className={`text-[10px] font-bold uppercase tracking-[0.3em] ${tier.color}`}>
                {tier.name}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-brand-navy">{tier.price}</span>
                <span className="text-sm text-muted">{tier.period}</span>
              </div>
              {tier.afterNote && (
                <div className="mt-1 text-[11px] text-muted">{tier.afterNote}</div>
              )}
              <ul className="mt-6 flex-1 space-y-2.5">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-secondary">
                    <Check />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`mt-6 block w-full rounded-xl px-5 py-3 text-center text-sm font-bold transition ${
                  tier.highlight
                    ? "bg-brand-teal text-black hover:bg-brand-teal-hover"
                    : "border border-default text-primary hover:border-strong hover:text-primary"
                }`}
              >
                {tier.cta} →
              </Link>
            </div>
          ))}
        </div>

        {/* What every tier includes */}
        <div className="mt-16 rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold text-brand-navy sm:text-3xl">
              Every tier includes DUM Points
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-secondary">
              Your customers automatically earn DUM Points on every purchase. Points are redeemable at any business on the network, bringing buyers back without you lifting a finger.
            </p>
          </div>
        </div>

        {/* How it compares */}
        <div className="mt-10 grid gap-3 sm:grid-cols-4">
          {[
            { icon: "💸", title: "Whatnot", desc: "8% + 2.9% per sale", bad: true },
            { icon: "💰", title: "Commonsold", desc: "% per sale + monthly", bad: true },
            { icon: "📍", title: "Google Maps", desc: "Pay to rank in ads", bad: true },
            { icon: "◆", title: "DUM Club", desc: "$29 to $99/mo flat", bad: false },
          ].map((comp) => (
            <div key={comp.title} className={`rounded-xl border p-4 text-center ${comp.bad ? "border-default bg-surface-muted" : "border-default bg-brand-teal-soft"}`}>
              <div className="text-xl">{comp.icon}</div>
              <div className={`mt-2 text-sm font-bold ${comp.bad ? "text-secondary" : "text-brand-teal"}`}>{comp.title}</div>
              <div className={`mt-1 text-[11px] ${comp.bad ? "text-state-live" : "text-brand-teal"}`}>{comp.desc}</div>
            </div>
          ))}
        </div>

        {/* Enterprise */}
        <div className="mt-16 rounded-2xl border border-default bg-surface-card px-8 py-10 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold text-brand-navy sm:text-3xl">
              Need more?
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-secondary">
              Business ($499/mo) and Enterprise ($2,000+/mo) tiers available for white-label loyalty programs, multi-location support, custom integrations, and dedicated account management.
            </p>
            <a
              href="mailto:julian@dum.club"
              className="mt-6 inline-flex items-center rounded-xl border border-default px-6 py-3 text-sm font-bold text-primary transition hover:border-brand-teal hover:text-brand-teal"
            >
              Contact Us →
            </a>
          </div>
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="text-sm text-muted transition hover:text-primary"
          >
            ← Back to home
          </Link>
        </div>

      </div>
    </div>
  );
}
