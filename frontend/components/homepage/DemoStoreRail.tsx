"use client";

/**
 * DemoStoreRail — the homepage's "fake it till you make it" example-shop
 * grid, shown ONLY while zero real businesses are currently live.
 *
 * Founder decision 2026-07-01 (supersedes the June "one tile" ruling; see
 * CLAUDE.md §12 rule 2): the Live Now empty state may show a full grid of
 * example shops so a first-time visitor sees what live local commerce on
 * DUM Club looks like, styled after the June 2026 handoff's tile design.
 *
 * Honesty rules (non-negotiable, from doctrine):
 * - Every tile carries an "EXAMPLE" badge. None says "LIVE", none uses the
 *   coral live-status color, none shows a viewer count. These shops are
 *   illustrations, not real broadcasts.
 * - Data-driven, not a manual toggle: the parent renders this only when the
 *   real live-projects list is empty, so real shows replace it automatically.
 * - Tiles link to /merchant — every tap converts curiosity into a founding
 *   merchant signup.
 */

import Link from "next/link";

type DemoShop = {
  name: string;
  item: string;
  price: number;
  category: "Eat" | "Fix" | "Move" | "Shop" | "Book";
  emoji: string;
  gradient: string; // tailwind gradient classes, category-flavored
};

const DEMO_SHOPS: DemoShop[] = [
  { name: "Ruth's Bakehouse", item: "Sourdough restock", price: 12, category: "Eat", emoji: "🍞", gradient: "from-amber-400 to-orange-600" },
  { name: "Tony's Pizza Co.", item: "Wood-fired pie night", price: 18, category: "Eat", emoji: "🍕", gradient: "from-orange-500 to-red-600" },
  { name: "Bangkok Kitchen", item: "Pad Thai & curry night", price: 14, category: "Eat", emoji: "🍜", gradient: "from-yellow-500 to-orange-500" },
  { name: "Sabor Colombiano", item: "Bandeja paisa Friday", price: 16, category: "Eat", emoji: "🍛", gradient: "from-red-500 to-rose-600" },
  { name: "Golden Dragon", item: "Dim sum brunch", price: 13, category: "Eat", emoji: "🥟", gradient: "from-rose-500 to-pink-600" },
  { name: "Blue Oak Farm Stand", item: "Peach season", price: 6, category: "Eat", emoji: "🍑", gradient: "from-green-500 to-emerald-600" },
  { name: "Sparkle Home Services", item: "Deep clean booking", price: 89, category: "Book", emoji: "🧽", gradient: "from-sky-400 to-blue-600" },
  { name: "Corner Bike Co.", item: "Tune-up special", price: 45, category: "Fix", emoji: "🚲", gradient: "from-slate-500 to-blue-700" },
  { name: "Garden State Movers", item: "Weekend slots open", price: 220, category: "Move", emoji: "🚚", gradient: "from-violet-500 to-purple-700" },
  { name: "Maple Street Boutique", item: "Vintage denim drop", price: 28, category: "Shop", emoji: "👖", gradient: "from-fuchsia-500 to-pink-600" },
];

export function DemoStoreRail() {
  return (
    <section className="mb-10">
      {/* Label row — mint dot, never the coral live dot (reserved for real
          broadcasts). Copy is explicit that these are examples. */}
      <div className="mb-1 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-mint-fill" aria-hidden="true" />
        <span className="text-[13px] font-bold uppercase tracking-[0.08em] text-primary">
          This is what live shopping looks like
        </span>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
          Example shops
        </span>
      </div>
      <p className="mb-4 text-sm text-secondary">
        Real local businesses are joining now.{" "}
        <Link href="/merchant" className="font-semibold text-mint-text hover:underline">
          Yours could be here →
        </Link>
      </p>

      <div className="flex flex-wrap gap-3.5">
        {DEMO_SHOPS.map((shop) => (
          <Link
            key={shop.name}
            href="/merchant"
            className={`group relative h-[230px] w-full grow-0 basis-[220px] overflow-hidden rounded-2xl bg-gradient-to-br ${shop.gradient} transition duration-150 hover:-translate-y-[3px] hover:brightness-105 max-[520px]:basis-[47%]`}
          >
            {/* Watermark emoji gives the tile photo-like weight without
                shipping third-party placeholder photos. */}
            <span
              className="absolute inset-0 flex items-center justify-center text-[64px] opacity-40 transition group-hover:opacity-55"
              aria-hidden="true"
            >
              {shop.emoji}
            </span>

            {/* Top chrome: EXAMPLE badge (never "LIVE") + category tag
                (never a viewer count). */}
            <span className="absolute left-2.5 top-2.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Example
            </span>
            <span className="absolute right-2.5 top-2.5 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white/90">
              {shop.category}
            </span>

            {/* Bottom scrim + copy, per the handoff tile anatomy. */}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-3 pt-8">
              <span className="block text-sm font-bold leading-tight text-white">
                {shop.name}
              </span>
              <span className="mt-0.5 block text-xs text-white/80">
                {shop.item} · ${shop.price}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
