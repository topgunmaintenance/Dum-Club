"use client";

/**
 * Compact hero for /discover — Pass 1.
 *
 * Max 260px desktop, 200px mobile. Hidden for authenticated
 * returning users (they go straight to the grid).
 *
 * Copy is doctrine-safe: no rewards claims, no network effects.
 */

import Link from "next/link";

export function DiscoverHero({ isAuthenticated }: { isAuthenticated?: boolean }) {
  if (isAuthenticated) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em] text-muted">
        ◆ DUM Club · Local Businesses · Live Storefronts
      </div>

      <h1 className="text-3xl font-bold tracking-[-0.02em] text-brand-navy sm:text-4xl md:text-5xl">
        Active local businesses and live deals nearby.
      </h1>

      <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-secondary sm:text-base">
        Live storefronts, flash deals, and loyalty rewards on one platform.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href="#grid"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-black transition hover:bg-brand-teal-hover"
        >
          Browse local ↓
        </a>
        <Link
          href="/merchant"
          className="inline-flex items-center gap-2 rounded-xl border border-default px-5 py-2.5 text-sm font-medium text-primary transition hover:border-strong hover:text-primary"
        >
          Become a merchant
        </Link>
      </div>
    </section>
  );
}
