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

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { lowestOfferPrice } from "../../lib/discover/filters";

const MAX = 12;

// Public base for the deterministic live-snapshot path the host uploads
// every ~10s (offers/live-thumbs/<projectId>.jpg). Same Supabase project
// the offer images already come from.
const SUPABASE_PUBLIC = process.env.NEXT_PUBLIC_SUPABASE_URL;

/**
 * LiveThumb — shows the real live preview frame when one exists, layered
 * over the cover/logo/monogram fallback. The snapshot <img> fades in only
 * once it actually loads (onLoad); if there's no frame yet (a 404 before
 * the host's first capture) it stays hidden and the fallback shows. No
 * flicker, and it recovers on its own once frames start landing.
 */
function LiveThumb({
  projectId,
  name,
  monogram,
  fallbackImg,
  bust,
}: {
  projectId: string;
  name: string;
  monogram: string;
  fallbackImg: string | null;
  bust: number;
}) {
  const base = SUPABASE_PUBLIC
    ? `${SUPABASE_PUBLIC}/storage/v1/object/public/offers/live-thumbs/${projectId}.jpg`
    : null;
  const [shown, setShown] = useState(false);
  return (
    <>
      {fallbackImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fallbackImg} alt={`${name} live`} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="text-3xl font-extrabold text-dum-live-accent">{monogram}</span>
        </div>
      )}
      {base && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${base}?t=${bust}`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onLoad={() => setShown(true)}
          onError={() => setShown(false)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 group-hover:scale-[1.02] ${shown ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </>
  );
}

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

  // Cache-bust the live snapshots on an interval so the card preview
  // refreshes while a shop is broadcasting (the host re-uploads ~every 10s).
  const [bust, setBust] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBust((b) => b + 1), 12000);
    return () => clearInterval(t);
  }, []);

  if (live.length === 0) return null;

  return (
    <section className="mb-10">
      {/* Section header — coral mono "LIVE NOW · N" pill on the left, "See all"
          on the right (links into the live-only filtered grid). */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-coral-bg px-2.5 py-1 font-mono text-[12px] font-bold uppercase tracking-[0.04em] text-coral">
          <span className="h-1.5 w-1.5 rounded-full bg-coral" />
          Live now · {live.length}
        </span>
        <Link
          href="/discover?live=1"
          className="text-[13px] font-bold text-mint-text transition hover:text-primary"
        >
          See all →
        </Link>
      </div>

      {/* 4-up grid of live-shop cards. Horizontally scrollable on mobile
          (~152px cards), settles into a 4-column grid from sm up. */}
      <div
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {live.map((p) => {
          const name = p.title || p.name || "Untitled";
          const monogram = (name.trim().charAt(0) || "•").toUpperCase();
          const img = cleanLogoUrl(p.business_profile?.cover_image_url) || cleanLogoUrl(p.business_profile?.logo_url);
          const price = lowestOfferPrice(p);
          const offerTitle = featuredOfferTitle(p);
          // Real concurrent-viewer count only — never fabricated. Absent on
          // the feed today (pending migration 077), so the eye-count slot
          // stays hidden until the number is real.
          const viewers = (p as { live_viewer_count?: number | null }).live_viewer_count;
          const showViewers = typeof viewers === "number" && viewers > 0;
          return (
            <Link
              key={p.id}
              href={`/project/${p.slug || p.id}?live=1`}
              className="group flex w-[152px] flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-default bg-surface-card shadow-dum-card transition hover:border-strong hover:shadow-dum-elev sm:w-auto"
              style={{ scrollSnapAlign: "start" }}
            >
              {/* Dark video thumb (~128px tall) with LIVE badge top-left and
                  eye-count top-right. */}
              <div className="relative h-32 overflow-hidden bg-dum-video">
                <LiveThumb projectId={p.id} name={name} monogram={monogram} fallbackImg={img} bust={bust} />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-coral px-2 py-0.5 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
                </span>
                {showViewers && (
                  <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white backdrop-blur-sm">
                    <span aria-hidden="true">👁</span>
                    {viewers}
                  </span>
                )}
              </div>

              {/* Body — avatar (26px) + shop name row, then current item + price. */}
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-dum-video">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[11px] font-extrabold text-dum-live-accent">{monogram}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-primary">{name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">
                    {offerTitle || "Live now"}
                  </span>
                  {price != null && (
                    <span className="flex-shrink-0 font-mono text-[13px] font-bold text-mint-text">
                      ${price < 1 ? price.toFixed(2) : Math.round(price)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
