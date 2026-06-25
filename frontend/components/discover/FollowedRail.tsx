"use client";

/**
 * FollowedRail — "From shops you follow" avatar strip atop /discover.
 *
 * A compact, personalised row of the signed-in viewer's followed shops,
 * live ones first. Deliberately NOT another big card rail: the LiveRail
 * directly below already renders full live cards for everyone, so this
 * is a lean circular-avatar strip (logo/emoji + name) that links straight
 * to each storefront — the viewer's own shops, one tap away.
 *
 * Renders nothing unless the viewer follows at least one shop, so signed-
 * out visitors and brand-new accounts never see an empty strip.
 *
 * Live-first ordering reuses the same live_started_at parsing as LiveRail
 * (Safari-safe), so the most-recently-live followed shop leads.
 */

import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { getProjectEmoji } from "../../lib/discover/filters";

// Cap the strip so a viewer who follows dozens of shops gets a tidy row;
// the dedicated "Your Clubs" page is the full list.
const MAX_AVATARS = 16;

// Parse projects.live_started_at (Postgres timestamptz) to epoch ms for
// live-first ordering. Same normalisation as LiveRail: PostgREST can return
// a space-separated / 2-digit-offset form ("2026-06-17 03:04:59.07+00")
// that strict engines (Safari) read as NaN unless coerced to ISO 8601.
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

export function FollowedRail({ projects }: { projects: Project[] }) {
  // Live shops first (most-recently-live leading), then the rest in feed
  // order. A stable sort keeps non-live followed shops in their incoming
  // order behind the live ones.
  const ordered = [...projects].sort((a, b) => {
    const aLive = a.is_live === true ? 1 : 0;
    const bLive = b.is_live === true ? 1 : 0;
    if (aLive !== bLive) return bLive - aLive;
    if (aLive && bLive) return liveStartedMs(b) - liveStartedMs(a);
    return 0;
  });
  const visible = ordered.slice(0, MAX_AVATARS);

  if (visible.length === 0) return null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">
          From shops you follow
        </h2>
        <Link
          href="/clubs"
          className="text-[11px] font-bold uppercase tracking-[0.12em] text-secondary transition hover:text-brand-teal"
        >
          Your Clubs →
        </Link>
      </div>

      <div
        className="flex gap-4 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {visible.map((project, index) => {
          const emoji = getProjectEmoji(project, index);
          const logoUrl = cleanLogoUrl(project.business_profile?.logo_url);
          const name = project.title || project.name || "Shop";
          const isLive = project.is_live === true;
          return (
            <Link
              key={project.id}
              href={`/project/${project.slug || project.id}${isLive ? "?live=1" : ""}`}
              className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5"
              style={{ scrollSnapAlign: "start" }}
              title={name}
            >
              <span
                className={`relative inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 bg-surface-muted ${
                  isLive ? "border-red-500" : "border-default"
                }`}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={`${name} logo`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-xl">{emoji}</span>
                )}
                {isLive && (
                  <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-1.5 py-px text-[8px] font-bold uppercase tracking-wide text-white shadow-sm">
                    Live
                  </span>
                )}
              </span>
              <span className="w-full truncate text-center text-[10px] font-medium text-secondary">
                {name}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
