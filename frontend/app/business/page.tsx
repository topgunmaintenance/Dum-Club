"use client";

/**
 * /business — seller recruitment story page.
 *
 * Pure pitch: hero, the five-expense-lines story, how it works,
 * what's included, and the trial CTA. All numbers content (tier
 * grid, savings calculator, fee comparisons) lives on /pricing —
 * this page links out instead of duplicating it. Legacy
 * ?tab=calculator / ?tab=compare / ?tab=pricing URLs redirect to
 * /pricing. CLAUDE.md v5.0 Section 3 pricing is the source of
 * truth for every number.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "../../lib/apiBase";

type FoundingStatus = {
  // /api/merchant/founding-status returns only this boolean now —
  // the count fields (founding_slots_remaining, total_cap) were
  // stripped from the public response in the founding-counter
  // hide-from-competitors PR. Re-adding them here would just
  // type a field that doesn't exist on the wire.
  founding_program_open: boolean;
};

export default function BusinessPage() {
  return (
    <Suspense fallback={null}>
      <BusinessPageInner />
    </Suspense>
  );
}

function BusinessPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [founding, setFounding] = useState<FoundingStatus | null>(null);

  // Legacy sub-tab URLs: the old tabbed page took ?tab=. Numbers
  // tabs moved to /pricing; unknown tab values render normally.
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "calculator") {
      router.replace("/pricing#calculator");
    } else if (tab === "compare" || tab === "pricing") {
      router.replace("/pricing");
    }
  }, [searchParams, router]);

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

  const programOpen = founding?.founding_program_open ?? true;

  return (
    <main className="min-h-screen bg-surface-page text-primary">
      {/* ── Hero ─────────────────────────────────────── */}
      <section className="relative overflow-hidden px-4 pb-8 pt-28 sm:pt-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_top,rgba(0,255,163,0.12),transparent_65%)]" />
        </div>

        <div className="relative mx-auto max-w-4xl text-center">
          {/* Scarcity pill removed (PR: hide public merchant-count
              metrics). The trial pitch lives in the hero paragraph
              below, so no message is lost. */}

          <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            Your shop. Your show.{" "}
            <span className="text-brand-teal">
              Your town watching.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
            Live selling for local business, right on your own website. Every business gets 30 days free. Your customers see you, ask questions, and buy on the spot. Flat monthly subscription + 1.5% sales fee. Industry-low (Whatnot takes up to 8%). Keep more of every sale.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/merchant"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
            >
              Put Your Shop On Air →
            </Link>
            <Link
              href="/discover"
              className="text-sm font-bold text-secondary underline-offset-4 transition hover:text-brand-teal hover:underline"
            >
              See the Marketplace
            </Link>
          </div>
        </div>
      </section>

      {/* ── Story content (formerly the Overview tab) ── */}
      <div className="mx-auto max-w-6xl px-4 py-12">
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
              { name: "Delivery apps", fees: "15 to 30%", detail: "of every order", muted: true },
              { name: "Live selling", fees: "up to 8% + fees", detail: "per sale", muted: true },
              { name: "Loyalty software", fees: "$50 to $300", detail: "per month", muted: true },
              { name: "SMS retention", fees: "$20 to $200", detail: "per month", muted: true },
              { name: "DUM Club", fees: "From $39", detail: "flat / month · 1.5% sales fee", muted: false },
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
            One subscription bill plus just 1.5% per sale.{" "}
            <span className="font-bold text-brand-teal">Keep more of every dollar.</span>
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
              Flat subscription. 1.5% sales fee. Industry-low. Customers who come back.
            </p>
            <div className="mt-12 grid gap-3 sm:grid-cols-3">
              {[
                { n: "01", title: "Just 1.5% per sale", desc: "Marketplaces take up to 8% per sale and delivery apps take 15 to 30%. DUM Club starts at $39/month plus a 1.5% sales fee. The lowest per-sale rate in live commerce." },
                { n: "02", title: "Stripe pays you direct", desc: "Connect Stripe once. Every sale hits your bank. We never hold your money." },
                { n: "03", title: "Customers come back automatically", desc: "DUM Points turn one-time buyers into repeat customers, with automatic customer win-back texts coming soon. Replaces the loyalty + SMS tools you're already paying for." },
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
              { title: "DUM Points loyalty", desc: "Customers earn points on every purchase, redeemable at any DUM Club seller. The loyalty network that brings them back." },
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

        {/* Trial CTA */}
        <section className="mb-16">
          <div className="rounded-3xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-10 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">Live selling for local business</div>
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-primary sm:text-4xl">
              Every business gets 30 days free.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-secondary">
              Live selling right on your own website. Your customers see you, ask questions, and buy on the spot.
            </p>
            {/* Live merchant-count counter stays removed. We do not
                surface live merchant-count metrics on public surfaces. */}
            <div className="mt-8">
              <Link
                href="/merchant"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
              >
                {programOpen ? "Put Your Shop On Air →" : "Join the Waitlist →"}
              </Link>
            </div>
          </div>
        </section>

        {/* Numbers link-out — tier grid, calculator, and comparisons
            all live on /pricing now (single source of truth). */}
        <section>
          <div className="mx-auto max-w-2xl">
            <Link
              href="/pricing"
              className="group block rounded-2xl border border-default bg-surface-card p-8 text-center shadow-sm transition-all hover:border-strong hover:shadow-md"
            >
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
                Pricing
              </div>
              <h2 className="mb-3 text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
                Numbers person?
              </h2>
              <p className="mx-auto mb-6 max-w-md text-sm text-secondary">
                Full pricing, the savings calculator, and the fee comparisons live on one page.
              </p>
              <span className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-brand-navy transition group-hover:bg-brand-teal-hover group-hover:text-white">
                See pricing, calculator & comparisons →
              </span>
            </Link>
          </div>
        </section>
      </div>

      {/* ── FAQ ───────────────────────────────────────── */}
      <section className="border-t border-default px-4 py-16">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
              FAQ
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
              Common questions
            </h2>
          </div>
          <div className="space-y-3">
            {[
              {
                q: "What if I don't have a website yet?",
                a: "You don't need one. You get a shop page on DUM Club either way. If you do have a website later, you can paste one line of code to show your live shop right on it.",
              },
              {
                q: "How fast can I be live?",
                a: "A few minutes. Sign in, enter your business name, connect Stripe when you're ready to take payments, and you can go live the same day.",
              },
            ].map((f) => (
              <details
                key={f.q}
                className="group rounded-2xl border border-default bg-surface-card p-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-semibold text-primary">
                  {f.q}
                  <span
                    className="text-secondary transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-secondary">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Talk to Julian CTA ────────────────────────── */}
      <section className="border-t border-default px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-3xl border border-default bg-surface-card p-10 text-center backdrop-blur-sm">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
            Questions?
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
            Talk to the team.
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm text-secondary">
            DUM Club was built by Julian Mero, founder of Topgun Maintenance LLC, the founding merchant. Send an inquiry and the team will get back same day.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-6">
            <Link
              href="/merchant"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-teal px-6 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              Open the inquiry form
            </Link>
          </div>
        </div>
      </section>

      <div className="border-t border-default px-4 py-10 text-center">
        <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">
          Stripe-powered payments · 1.5% sales fee · Live selling for local business · DUM Club v5.0
        </p>
      </div>
    </main>
  );
}
