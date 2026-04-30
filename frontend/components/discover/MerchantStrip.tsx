"use client";

/**
 * Merchant recruitment footer strip.
 * Single CTA — the only seller-facing element on /discover.
 */

import Link from "next/link";

export function MerchantStrip() {
  return (
    <section className="mt-12 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-6 py-8 text-center sm:px-10">
      <p className="text-base font-semibold text-white sm:text-lg">
        Own a local business?
      </p>
      <p className="mt-2 text-sm text-zinc-300 sm:text-base">
        Flat $29/mo, 0% commission. First 100 merchants lock in forever.
      </p>
      <Link
        href="/merchant"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold uppercase tracking-[0.08em] text-black transition hover:bg-emerald-300 hover:shadow-[0_0_24px_rgba(0,255,163,0.25)]"
      >
        Become a founding merchant
      </Link>
    </section>
  );
}
