"use client";

/**
 * HomeSellPitch — the merchant pitch block that closes the homepage.
 *
 * Renders below the Club home marketplace feed on / only (ClubHome's
 * homeVariant prop): the "Sell Live" headline, the canonical Founding-100
 * offer copy (CLAUDE.md §3), the prove-it's-simple stat row, and the
 * interactive go-live phone demo inside a dark section.
 *
 * This replaces the old /welcome marketing page (removed 2026-07-01) —
 * the pitch and demo now live on the main page instead of an unlinked
 * side URL. /discover keeps the compact MerchantStrip instead.
 */

import Link from "next/link";

export function HomeSellPitch() {
  return (
    <>
      {/* ── SELL-LIVE PITCH ── */}
      <section className="mt-16 px-4 text-center sm:mt-20">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted">
          Limited · Founding 100
        </p>
        <h2 className="mx-auto mt-3 max-w-3xl text-[clamp(32px,6vw,52px)] font-extrabold leading-[1.08] tracking-[-0.02em] text-primary">
          Sell Live. Keep More of Every Dollar.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-base font-medium leading-relaxed text-secondary sm:text-lg">
          Join the first 100 merchants. Get 60 days free and lock in founding
          pricing for life.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-sm font-medium leading-relaxed text-secondary sm:text-base">
          Flat monthly subscription + 1.5% sales fee. Industry-low (Whatnot
          takes up to 8%). Keep more of every sale.
        </p>

        {/* Stat row — the prove-it's-simple numbers, mirrored in the demo. */}
        <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-6 border-t border-default pt-8">
          {[
            { n: "1.5%", label: "sales fee" },
            { n: "$39/mo", label: "flat" },
            { n: "3 taps", label: "to go live" },
          ].map((stat, i) => (
            <div key={stat.label} className="flex items-center gap-6">
              {i > 0 && (
                <span className="h-4 w-px bg-border-default" aria-hidden="true" />
              )}
              <div className="text-center">
                <div className="text-xl font-bold text-mint-text">{stat.n}</div>
                <div className="text-[13px] text-secondary">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/merchant"
            className="inline-flex items-center gap-2 rounded-xl bg-mint-fill px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] text-mint-fill-ink shadow-dum-card transition hover:brightness-105"
          >
            Claim Your Founding Spot
          </Link>
          <a
            href="#demo"
            className="text-sm font-semibold text-primary underline underline-offset-4 transition hover:text-mint-text"
          >
            See it in action ↑
          </a>
        </div>
      </section>

      {/* The interactive go-live demo (#demo / GoLiveDemoPhone) moved UP the
          homepage — it renders above the businesses grid in ClubHome now
          (founder decision 2026-07-06), so the pitch is the page's closer
          and the demo is its second act. */}
    </>
  );
}
