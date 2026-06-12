"use client";

/**
 * Live Rail — horizontal scroll of live sellers.
 *
 * Renders ONLY if items.some(isLive). Returns null otherwise.
 *
 * Video in the feed: the first MAX_AUTOPLAY_PREVIEWS live cards embed
 * the actual show — IVSStageViewer in muted preview mode (joins the
 * Real-Time stage as a SUBSCRIBER, like the storefront watch view).
 * Cards beyond that stay static (logo/emoji) to bound cost: every
 * preview viewer is a billed Real-Time participant (~$0.10/viewer-hr
 * list) until the HLS playback path ships — accepted tradeoff, see
 * .claude/tasks/video-architecture-passive-playback.md. Tapping
 * anywhere on a card (video included — pointer-events disabled on the
 * preview) lands on the storefront watch view.
 *
 * Card cap: at most MAX_LIVE_CARDS cards render; past that, one
 * overflow card links to /discover?live=1 (the discover page
 * already reads live=1 and switches to live-only). Ordering
 * inherits the projects prop as-is; most-recently-live-first
 * needs projects.live_started_at and ships with the queued
 * live-started-at task, not here.
 */

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { getProjectEmoji, getAccent, lowestOfferPrice } from "../../lib/discover/filters";
import { classifyProject } from "../../lib/categories";

// Browser-only: pulls in amazon-ivs-web-broadcast (WebRTC).
const IVSStageViewer = dynamic(
  () => import("../IVSStageViewer").then((m) => ({ default: m.IVSStageViewer })),
  { ssr: false }
);

const MAX_LIVE_CARDS = 12;
// Muted-autoplay video on at most this many rail cards; the rest stay
// static thumbnails. Keeps worst-case preview cost at two Real-Time
// participants per homepage visitor regardless of how many merchants
// are live.
const MAX_AUTOPLAY_PREVIEWS = 2;

export function LiveRail({ projects }: { projects: Project[] }) {
  const liveProjects = projects.filter((p) => p.is_live === true);
  const visibleProjects = liveProjects.slice(0, MAX_LIVE_CARDS);
  const overflowCount = liveProjects.length - visibleProjects.length;
  // Project IDs whose <img> failed to load. We keep this at the rail
  // level (rather than per-card local state) so we don't have to
  // extract every card into its own component just to host one piece
  // of fallback state. On failure, the project ID is added and the
  // card flips back to the emoji avatar — same backwards-compat
  // behavior as ListingCard's per-card state.
  const [failedLogos, setFailedLogos] = useState<Set<string>>(() => new Set());
  if (liveProjects.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">
          Live Now
        </h2>
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">
          {liveProjects.length}
        </span>
      </div>

      <div
        className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {visibleProjects.map((project, index) => {
          const emoji = getProjectEmoji(project, index);
          const category = classifyProject(project);
          const accent = getAccent(index);
          const price = lowestOfferPrice(project);
          const rawLogo = cleanLogoUrl(project.business_profile?.logo_url);
          const logoUrl = rawLogo && !failedLogos.has(project.id) ? rawLogo : null;

          return (
            <Link
              key={project.id}
              href={`/project/${project.slug || project.id}?live=1`}
              className="flex w-[280px] flex-shrink-0 flex-col rounded-xl border border-[var(--state-live)]/30 bg-surface-card p-4 transition hover:border-[var(--state-live)]/30"
              style={{ scrollSnapAlign: "start" }}
            >
              {/* The actual show, muted, on the first cards only.
                  pointer-events-none so every tap falls through to
                  the Link and lands on the storefront watch view. */}
              {index < MAX_AUTOPLAY_PREVIEWS && (
                <div className="pointer-events-none mb-3">
                  <IVSStageViewer projectId={project.id} userId="" preview />
                </div>
              )}
              <div className="mb-3 flex items-center justify-between">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={`${project.title || project.name || "Business"} logo`}
                    loading="lazy"
                    onError={() => {
                      setFailedLogos((prev) => {
                        if (prev.has(project.id)) return prev;
                        const next = new Set(prev);
                        next.add(project.id);
                        return next;
                      });
                    }}
                    className="h-7 w-7 rounded-md border border-default object-cover"
                  />
                ) : (
                  <span className="text-2xl">{emoji}</span>
                )}
                <div className="flex items-center gap-2">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-red-400">
                    LIVE
                  </span>
                </div>
              </div>

              <h3 className="text-sm font-bold text-primary">
                {project.title || project.name || "Untitled"}
              </h3>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted">
                {project.description || ""}
              </p>

              <div className="mt-auto flex items-center justify-between pt-3">
                {price != null && (
                  <span className="text-xs font-bold text-brand-teal">
                    From ${price < 1 ? price.toFixed(2) : Math.round(price)}
                  </span>
                )}
                <span className="ml-auto text-[10px] font-medium text-red-400">
                  Watch live →
                </span>
              </div>
            </Link>
          );
        })}

        {overflowCount > 0 && (
          <Link
            href="/discover?live=1"
            className="flex w-[280px] flex-shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--state-live)]/30 bg-surface-card p-4 transition hover:border-[var(--state-live)]/30"
            style={{ scrollSnapAlign: "start" }}
          >
            <span className="text-lg font-bold text-primary">
              +{overflowCount} more live
            </span>
            <span className="text-[10px] font-medium text-red-400">
              See all live →
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
