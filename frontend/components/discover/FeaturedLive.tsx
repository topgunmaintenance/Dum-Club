"use client";

/**
 * FeaturedLive — desktop "browse the club" hero banner: the top live show as a
 * wide featured card (the mock's right-panel banner). Desktop only
 * (hidden lg:block); on mobile the LiveNowGrid carries every live show.
 *
 * De-dupe: the page passes this show's id to LiveNowGrid, which hides that one
 * card on lg so the featured show isn't shown twice on desktop.
 *
 * Real data only — renders nothing when no show is live.
 */

import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";

export function FeaturedLive({ project }: { project: Project | null }) {
  if (!project || project.is_live !== true) return null;

  const businessName = project.title || project.name || "Untitled";
  const showTitle = project.description?.trim() || businessName;
  const handle = project.slug ? `@${project.slug}` : null;
  // active_auction_id rides the public feed (mig 022); when present the show is
  // taking bids.
  const bidding = !!(project as { active_auction_id?: string | null }).active_auction_id;
  const cover = cleanLogoUrl(project.business_profile?.cover_image_url) || cleanLogoUrl(project.business_profile?.logo_url);
  const monogram = (businessName.trim().charAt(0) || "•").toUpperCase();
  const href = `/project/${project.slug || project.id}?live=1`;

  return (
    <Link href={href} className="group mb-6 hidden lg:block">
      <div className="relative aspect-[21/9] w-full overflow-hidden rounded-2xl border border-default bg-surface-inverse">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={`${businessName} live`} className="h-full w-full object-cover transition group-hover:scale-[1.01]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-7xl font-extrabold text-white/20">{monogram}</span>
          </div>
        )}
        {/* Bottom scrim for legibility */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 to-transparent" />

        {/* LIVE pill, top-left */}
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-state-live px-3 py-1 shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-white">
            Live{bidding ? " · bidding open" : ""}
          </span>
        </span>

        {/* Title + seller, bottom-left */}
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <h2 className="line-clamp-1 text-2xl font-extrabold tracking-tight">{showTitle}</h2>
          <p className="mt-1 text-sm text-white/80">
            {handle}
            {bidding ? " · bidding open" : " · live now"}
          </p>
        </div>
      </div>
    </Link>
  );
}
