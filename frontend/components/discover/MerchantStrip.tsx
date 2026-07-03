"use client";

/**
 * Merchant recruitment footer strip.
 * Single CTA — the only seller-facing element on /discover.
 */

import Link from "next/link";

export function MerchantStrip() {
  return (
    <section className="mt-12 rounded-2xl border border-default bg-surface-muted px-6 py-8 text-center shadow-dum-card sm:px-10">
      <p className="text-base font-bold text-primary sm:text-lg">
        Own a local business?
      </p>
      <p className="mt-2 text-sm font-medium text-secondary sm:text-base">
        Flat $39/mo plus 1.5% sales fee. Industry-low (Whatnot takes up to 8%). Lock in founding pricing for life.
      </p>
      <Link
        href="/merchant"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-mint-fill px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] text-mint-fill-ink shadow-dum-card transition hover:brightness-105"
      >
        Claim Your Founding Spot
      </Link>
    </section>
  );
}
