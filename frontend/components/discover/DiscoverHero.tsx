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
    <section className="mb-8 max-h-[200px] sm:max-h-[260px]">
      <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-500">
        ◆ DUM Club · Local Businesses · Live Sellers
      </div>

      <h1 className="text-3xl font-bold tracking-[-0.02em] text-white sm:text-4xl md:text-5xl">
        Shop local. Meet the sellers behind it.
      </h1>

      <p className="mt-3 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
        Live sellers and local businesses on one platform. Beta — more sellers added weekly.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href="#grid"
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold uppercase tracking-[0.08em] text-black transition hover:bg-emerald-300 hover:shadow-[0_0_24px_rgba(0,255,163,0.3)]"
        >
          Browse sellers ↓
        </a>
        <Link
          href="/merchant"
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-white"
        >
          Become a merchant
        </Link>
      </div>
    </section>
  );
}
