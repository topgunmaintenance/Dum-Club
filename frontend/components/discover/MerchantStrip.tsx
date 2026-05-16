"use client";

/**
 * Merchant recruitment footer strip.
 * Single CTA — the only seller-facing element on /discover.
 */

import Link from "next/link";

export function MerchantStrip() {
  return (
    <section className="mt-12 rounded-xl border border-default bg-surface-muted px-6 py-8 text-center sm:px-10">
      <p className="text-base font-semibold text-brand-navy sm:text-lg">
        Own a local business?
      </p>
      <p className="mt-2 text-sm font-medium text-primary sm:text-base">
        Flat $29/mo. 0% commission, always. Founding merchants get preferred pricing after launch.
      </p>
      <Link
        href="/merchant"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] text-black transition hover:bg-brand-teal-hover"
      >
        Claim Your Founding Spot
      </Link>
    </section>
  );
}
