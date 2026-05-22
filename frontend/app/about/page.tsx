import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About DUM Club. Built by a Local Business, for Local Businesses",
  description:
    "DUM Club was built by Julian Mero, founder of Topgun Maintenance LLC. Drive Ur Market. The loyalty network for local business. Flat monthly fee, 0% commission, always.",
  openGraph: {
    title: "About DUM Club. Built by a Local Business, for Local Businesses",
    description:
      "Built by Julian Mero, founder of Topgun Maintenance LLC. Drive Ur Market. Flat monthly fee, 0% commission, always.",
    siteName: "DUM Club",
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <main className="relative min-h-screen bg-surface-page px-4 pt-24 pb-20 text-primary sm:px-6">
      <div className="mx-auto max-w-3xl">
        {/* Eyebrow */}
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.32em] text-brand-teal">
          Drive Ur Market
        </p>

        {/* Hero */}
        <h1 className="text-4xl font-extrabold tracking-tight text-brand-navy sm:text-5xl">
          Built by a local business, for local businesses.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
          DUM Club is the loyalty network for local commerce. Live selling,
          DUM Points loyalty, automatic customer win-back texts, and flash
          sales. Every tool a local business needs to keep its own customers,
          on its own website, for one flat monthly fee. No commissions, ever.
        </p>

        {/* Founder Note */}
        <section
          aria-labelledby="founder-heading"
          className="mt-12 rounded-2xl border border-default border-l-4 border-l-brand-teal bg-surface-card p-6 shadow-sm sm:p-8"
        >
          <h2
            id="founder-heading"
            className="text-[10px] font-bold uppercase tracking-[0.25em] text-brand-teal"
          >
            Founder Note
          </h2>
          <div className="mt-4 flex items-start gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Julian.jpeg"
                alt="Julian Mero, founder of DUM Club"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex-1">
              <p className="text-[15px] leading-relaxed text-primary sm:text-base">
                <span className="font-semibold text-brand-navy">I&apos;m Julian.</span>{" "}
                I built DUM Club because I run a real business too.
                Topgun Maintenance LLC has been serving aircraft owners
                across NY, NJ, PA, CT, and DE since long before any of
                this. I was tired of platforms taking a cut every time
                a business made a sale, and tired of paying for five
                separate tools (delivery apps, live selling, loyalty,
                SMS retention, and an agency) when none of them talked
                to each other.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-primary sm:text-base">
                DUM Club is the platform I wished existed: flat fee,
                zero commission, every tool included. Built for the
                shop owner who already paid for the website and just
                wants more customers walking in.
              </p>
              <div className="mt-5 font-caveat text-[22px] leading-none text-brand-navy">
                Julian
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-secondary">
                Julian Mero · Founder · Topgun Maintenance LLC
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Morristown, NJ · Founding Merchant #1
              </div>
            </div>
          </div>
        </section>

        {/* Why this exists */}
        <section className="mt-12">
          <h2 className="text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl">
            Why DUM Club exists
          </h2>
          <p className="mt-4 text-base leading-relaxed text-secondary">
            Local businesses already pay for the tools they need to compete
            online. The math doesn&apos;t add up: 15 to 30% to delivery apps,
            8% + 2.9% to live-selling platforms, $50 to $300 a month to loyalty
            software, $20 to $200 a month to SMS retention, $500+ a month to an
            agency for social posts. DUM Club replaces that entire stack
            with one flat bill, from $29 to $99 a month depending on tier, so
            the owner keeps the customer, the data, and 100% of every
            sale.
          </p>
        </section>

        {/* What you get */}
        <section className="mt-10">
          <h2 className="text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl">
            What&apos;s included
          </h2>
          <ul className="mt-5 space-y-3">
            {[
              {
                label: "Live selling on your own page",
                body: "Add live shopping to any business website with a single script tag. No marketplace, no commission per sale.",
              },
              {
                label: "DUM Points loyalty across the network",
                body: "Customers earn points at every DUM Club merchant and redeem at any other. Built-in switching cost for your customers.",
              },
              {
                label: "Automatic customer win-back texts (Growth+)",
                body: "Automated point-expiry reminders, plus customers can find nearby deals across the network. Replaces $500 to $1,000 a month in direct-mail spend.",
              },
              {
                label: "Local flash sales",
                body: "Surface deals to nearby buyers without paying-to-rank against bigger competitors.",
              },
            ].map((item) => (
              <li
                key={item.label}
                className="rounded-xl border border-default bg-surface-card p-4"
              >
                <div className="font-semibold text-brand-navy">
                  {item.label}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-secondary">
                  {item.body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Pricing teaser */}
        <section className="mt-12 rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
            Pricing
          </div>
          <p className="mt-3 text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl">
            Flat $29 to $99 a month. 0% commission. Always.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-secondary">
            Join the first 100 merchants. Get 60 days free and lock in
            founding pricing for life. No credit card required to start.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-teal px-5 text-sm font-semibold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              See full pricing →
            </Link>
            <Link
              href="/merchant"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-default bg-surface-card px-5 text-sm font-semibold text-brand-navy transition hover:border-strong"
            >
              Claim Your Founding Spot
            </Link>
          </div>
        </section>

        {/* Contact / talk to Julian */}
        <section
          aria-labelledby="contact-heading"
          className="mt-12 rounded-2xl border border-default bg-surface-card p-8"
        >
          <h2
            id="contact-heading"
            className="text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl"
          >
            Talk to Julian directly
          </h2>
          <p className="mt-3 text-base leading-relaxed text-secondary">
            Investor, merchant, partner, or just curious. The easiest way
            to reach the founder is email. No gatekeepers.
          </p>
          <div className="mt-5 space-y-1 text-sm">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Email
              </span>
              <div>
                <a
                  href="mailto:julian@topgunmaintenance.com"
                  className="font-semibold text-brand-teal hover:text-brand-teal-hover"
                >
                  julian@topgunmaintenance.com
                </a>
              </div>
            </div>
            <div className="pt-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Business
              </span>
              <div className="text-primary">
                Topgun Maintenance LLC · Morristown, NJ (MMU)
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
