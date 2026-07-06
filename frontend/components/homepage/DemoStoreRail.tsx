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
 * - Tiles link to the homepage's #demo section (founder decision
 *   2026-07-06, supersedes the original link-to-/merchant ruling): a
 *   visitor tapping an example shop expects to SEE live shopping, so the
 *   tap lands on the interactive "Watch a shop go live" demo. The demo
 *   itself ends in the founding-spot CTA, so the conversion path holds.
 */

import Link from "next/link";

type DemoShop = {
  name: string;
  item: string;
  price: number;
  category: "Eat" | "Fix" | "Move" | "Shop" | "Book";
  photoId: string; // Unsplash photo path segment, manually matched to the business
  gradient: string; // tailwind gradient classes — paints while the photo loads
};

/* Photos are hotlinked from Unsplash's CDN (images.unsplash.com), which
   Unsplash's license and guidelines explicitly allow for commercial use,
   no attribution required. Each ID was hand-picked from search results so
   the photo genuinely resembles the business (no random-placeholder drift
   like loremflickr — direct photo IDs are stable). If we ever want zero
   third-party runtime dependency, download these and serve from /public. */
const unsplashUrl = (photoId: string) =>
  `https://images.unsplash.com/${photoId}?w=440&h=460&q=60&auto=format&fit=crop`;

const DEMO_SHOPS: DemoShop[] = [
  { name: "Ruth's Bakehouse", item: "Sourdough restock", price: 12, category: "Eat", photoId: "photo-1613396874083-2d5fbe59ae79", gradient: "from-amber-400 to-orange-600" },
  { name: "Tony's Pizza Co.", item: "Wood-fired pie night", price: 18, category: "Eat", photoId: "photo-1579751626657-72bc17010498", gradient: "from-orange-500 to-red-600" },
  { name: "Bangkok Kitchen", item: "Pad Thai & curry night", price: 14, category: "Eat", photoId: "photo-1637806930600-37fa8892069d", gradient: "from-yellow-500 to-orange-500" },
  { name: "Sabor Colombiano", item: "Bandeja paisa Friday", price: 16, category: "Eat", photoId: "photo-1723693407562-bb4fcae76797", gradient: "from-red-500 to-rose-600" },
  { name: "Golden Dragon", item: "Dim sum brunch", price: 13, category: "Eat", photoId: "photo-1604632910793-c0601f361b34", gradient: "from-rose-500 to-pink-600" },
  { name: "Blue Oak Farm Stand", item: "Peach season", price: 6, category: "Eat", photoId: "photo-1639588473831-dd9d014646ae", gradient: "from-green-500 to-emerald-600" },
  { name: "Sparkle Home Services", item: "Deep clean booking", price: 89, category: "Book", photoId: "photo-1581578949510-fa7315c4c350", gradient: "from-sky-400 to-blue-600" },
  { name: "Corner Bike Co.", item: "Tune-up special", price: 45, category: "Fix", photoId: "photo-1760310936486-4dd450aab2a8", gradient: "from-slate-500 to-blue-700" },
  { name: "Garden State Movers", item: "Weekend slots open", price: 220, category: "Move", photoId: "photo-1616432043562-3671ea2e5242", gradient: "from-violet-500 to-purple-700" },
  { name: "Maple Street Boutique", item: "Vintage denim drop", price: 28, category: "Shop", photoId: "photo-1631112230741-446762ee05ac", gradient: "from-fuchsia-500 to-pink-600" },
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
        {/* Plain <a>, not next/link: Link to a same-page hash updates the
            URL without scrolling (app-router quirk, verified live
            2026-07-06). Native anchors scroll correctly — same reason the
            hero's Watch the demo button is an <a>. */}
        {DEMO_SHOPS.map((shop) => (
          <a
            key={shop.name}
            href="#demo"
            className={`group relative h-[230px] w-full grow-0 basis-[220px] overflow-hidden rounded-2xl bg-gradient-to-br ${shop.gradient} transition duration-150 hover:-translate-y-[3px] hover:brightness-105 max-[520px]:basis-[47%]`}
          >
            {/* Real photo, full bleed. The gradient class behind it paints
                instantly while the image loads, so tiles never flash white. */}
            <span
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${unsplashUrl(shop.photoId)})` }}
              aria-hidden="true"
            />

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
          </a>
        ))}
      </div>
    </section>
  );
}
