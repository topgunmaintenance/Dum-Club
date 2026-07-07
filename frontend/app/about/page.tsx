import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About DUM Club. Built by a Local Business, for Local Businesses",
  description:
    "DUM Club was built by Julian Mero, founder of Topgun Maintenance LLC. Drive Ur Market. The loyalty network for local business. Flat monthly subscription plus a 1.5% sales fee. Industry-low.",
  openGraph: {
    title: "About DUM Club. Built by a Local Business, for Local Businesses",
    description:
      "Built by Julian Mero, founder of Topgun Maintenance LLC. Drive Ur Market. Flat monthly subscription plus a 1.5% sales fee. Industry-low.",
    siteName: "DUM Club",
    type: "website",
  },
};

// ISR: static marketing content, regenerate at most hourly.
export const revalidate = 3600;

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
          on its own website, for one flat monthly subscription plus a 1.5% sales fee.
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
                DUM Club is the platform I wished existed: flat monthly
                fee plus just 1.5% per sale (Whatnot takes up to 8%), every tool
                included. Built for the shop owner who already paid for
                the website and just wants more customers walking in.
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
          <ul className="mt-5 space-y-3">
            {[
              {
                title: "The math problem",
                body: "Delivery apps take 15 to 30%. Live-selling platforms take up to 8% + 2.9%. The fees never stop.",
              },
              {
                title: "The customer-ownership problem",
                body: "On those platforms the customer belongs to them, not to you. You rent your own traffic.",
              },
              {
                title: "The fragmented-tools problem",
                body: "Loyalty, SMS, social, deals. Five separate monthly bills that don't talk to each other.",
              },
            ].map((row) => (
              <li
                key={row.title}
                className="rounded-xl border border-default bg-surface-card p-4"
              >
                <div className="font-semibold text-brand-navy">{row.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-secondary">{row.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-base leading-relaxed text-secondary">
            DUM Club replaces that whole stack with one flat bill, starting at
            $39/month, so you keep the customer, the data, and more of every dollar.
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
                body: "Add live shopping to any business website with a single script tag. No marketplace; just 1.5% per sale (vs Whatnot's up to 8%).",
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
            Starting at $39/month plus a 1.5% sales fee. Always.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-secondary">
            Join the first 100 merchants. Get 30 days free and lock in
            founding pricing for life. Cancel any time during the trial.
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

        {/* Contact / talk to Julian — id="contact" is the anchor the
            /contact redirect lands on. */}
        <section
          id="contact"
          aria-labelledby="contact-heading"
          className="mt-12 scroll-mt-24 rounded-2xl border border-default bg-surface-card p-8"
        >
          <h2
            id="contact-heading"
            className="text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl"
          >
            Talk to the team
          </h2>
          <p className="mt-3 text-base leading-relaxed text-secondary">
            Investor, merchant, partner, or just curious. Send an inquiry through the form and the team will get back same day.
          </p>
          <div className="mt-5 space-y-1 text-sm">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
                Business
              </span>
              <div className="text-primary">
                Topgun Maintenance LLC · Morristown, NJ (MMU)
              </div>
            </div>
          </div>
          <div className="mt-6 flex flex-col items-start gap-3">
            <Link
              href="/merchant"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-teal px-6 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Open the inquiry form
            </Link>
          </div>
          <p className="mt-6 text-[13px] text-secondary">
            Investor?{" "}
            <Link href="/investors" className="font-semibold text-brand-teal underline-offset-4 hover:underline">
              See our investor page
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
