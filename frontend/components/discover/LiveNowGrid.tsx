"use client";

/**
 * LiveNowGrid — "The Club" home: live sellers as a 2-up portrait grid.
 *
 * The buyer-home take on live content (vs the homepage's horizontal LiveRail):
 * two columns of tall portrait cards, each with a coral LIVE badge, the show
 * title, and the seller handle. Thumbnail cascades cover -> logo -> a mint
 * monogram (never a random emoji), matching the merchant cards.
 *
 * Most-recently-live first (projects.live_started_at, Safari-safe parse).
 * Renders nothing when no shop is live. No fabricated viewer counts — the
 * per-project live count isn't on the feed yet (pending migration 077), so the
 * card shows LIVE without a number rather than a made-up one.
 */

import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";

const MAX_LIVE = 8;

function liveStartedMs(p: Project): number {
  const raw = p.live_started_at;
  if (!raw) return -Infinity;
  const iso = raw
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? -Infinity : ms;
}

export function LiveNowGrid({ projects }: { projects: Project[] }) {
  const live = projects
    .filter((p) => p.is_live === true)
    .sort((a, b) => liveStartedMs(b) - liveStartedMs(a))
    .slice(0, MAX_LIVE);

  if (live.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-state-live" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">Live now</h2>
        <span className="rounded-full bg-state-live/15 px-2 py-0.5 text-[10px] font-bold text-state-live">
          {live.length}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {live.map((p) => {
          const businessName = p.title || p.name || "Untitled";
          const showTitle = p.description?.trim() || businessName;
          const handle = p.slug ? `@${p.slug}` : null;
          const cover = cleanLogoUrl(p.business_profile?.cover_image_url);
          const logo = cleanLogoUrl(p.business_profile?.logo_url);
          const img = cover || logo;
          const monogram = (businessName.trim().charAt(0) || "•").toUpperCase();
          return (
            <Link
              key={p.id}
              href={`/project/${p.slug || p.id}?live=1`}
              className="group flex flex-col"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-default bg-brand-teal-soft">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={`${businessName} live`} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="text-4xl font-extrabold text-mint-text">{monogram}</span>
                  </div>
                )}
                {/* LIVE badge */}
                <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-state-live px-2 py-0.5 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
                </span>
              </div>
              <h3 className="mt-2 line-clamp-1 text-[13px] font-bold text-primary">{showTitle}</h3>
              {handle && <span className="line-clamp-1 text-[11px] text-secondary">{handle}</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
