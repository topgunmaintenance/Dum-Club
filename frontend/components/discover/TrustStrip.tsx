"use client";

/**
 * Trust strip — 3 static trust items, single row, no carousel.
 *
 * No claims of buyer protection (no policy yet).
 * No points copy (§12 Rule 4).
 */

export function TrustStrip() {
  return (
    <div className="mb-6 flex items-center gap-6 overflow-x-auto rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-3 text-[11px] text-zinc-400 sm:gap-8 sm:text-xs [&::-webkit-scrollbar]:hidden">
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="text-base">🔒</span>
        <span>Stripe-secured checkout</span>
      </div>
      <div className="h-3 w-px flex-shrink-0 bg-zinc-700/60" />
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="text-base">💳</span>
        <span>Sellers paid direct via Stripe Connect</span>
      </div>
      <div className="h-3 w-px flex-shrink-0 bg-zinc-700/60" />
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="text-base">✅</span>
        <span>Founding merchants personally verified</span>
      </div>
    </div>
  );
}
