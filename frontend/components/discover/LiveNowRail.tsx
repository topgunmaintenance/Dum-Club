"use client";

/**
 * LiveNowRail — the signature Option B element: a horizontal row of shops
 * currently broadcasting (is_live + an IVS stage), most-recently-live first.
 *
 * Each card: live thumbnail (cover/logo/clean mint tile), a coral ● LIVE
 * badge, the shop name, its featured offer + price, and a tap straight into
 * the hosted live room (/project/[slug]?live=1).
 *
 * Renders nothing when no shop is live. No fabricated viewer counts — the
 * per-shop live count isn't on the feed yet (pending migration 077); the
 * badge shows LIVE without a number rather than a made-up one.
 */

import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { lowestOfferPrice } from "../../lib/discover/filters";

const MAX = 12;

function liveStartedMs(p: Project): number {
  const raw = p.live_started_at;
  if (!raw) return -Infinity;
  const iso = raw.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

function featuredOfferTitle(p: Project): string {
  const items = Array.isArray(p.store_items) ? p.store_items : [];
  const it = items.find((i: Record<string, unknown>) => Number(i?.price_usd ?? i?.price ?? 0) > 0) || items[0];
  return ((it?.title as string) || (it?.name as string) || "").trim() || p.description?.trim() || "";
}

export function LiveNowRail({ projects }: { projects: Project[] }) {
  const live = projects
    .filter((p) => p.is_live === true)
    .sort((a, b) => liveStartedMs(b) - liveStartedMs(a))
    .slice(0, MAX);

  if (live.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-state-live" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">Live now</h2>
        <span className="rounded-full bg-state-live/15 px-2 py-0.5 text-[10px] font-bold text-state-live">{live.length}</span>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0" style={{ scrollSnapType: "x mandatory" }}>
        {live.map((p) => {
          const name = p.title || p.name || "Untitled";
          const monogram = (name.trim().charAt(0) || "•").toUpperCase();
          const img = cleanLogoUrl(p.business_profile?.cover_image_url) || cleanLogoUrl(p.business_profile?.logo_url);
          const price = lowestOfferPrice(p);
          const offerTitle = featuredOfferTitle(p);
          return (
            <Link
              key={p.id}
              href={`/project/${p.slug || p.id}?live=1`}
              className="group flex w-[240px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-default bg-surface-card shadow-sm transition hover:border-strong hover:shadow-md"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="relative aspect-video overflow-hidden bg-brand-teal-soft">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={`${name} live`} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-3xl font-extrabold text-mint-text">{monogram}</span>
                  </div>
                )}
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-state-live px-2 py-0.5 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="text-[9px] font-bold uppercase tracking-wide text-white">Live</span>
                </span>
              </div>
              <div className="flex flex-1 flex-col p-3">
                <span className="truncate text-[13px] font-bold text-primary">{name}</span>
                {offerTitle && <span className="mt-0.5 line-clamp-1 text-[11px] text-secondary">{offerTitle}</span>}
                <div className="mt-auto flex items-center justify-between pt-2">
                  {price != null ? (
                    <span className="font-mono text-sm font-extrabold text-mint-text">
                      ${price < 1 ? price.toFixed(2) : Math.round(price)}
                    </span>
                  ) : (
                    <span className="text-[10px] uppercase tracking-[0.1em] text-secondary">Live deals</span>
                  )}
                  <span className="text-[10px] font-bold text-state-live">Watch live →</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
