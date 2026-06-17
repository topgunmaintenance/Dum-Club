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
import { classifyProject, CATEGORIES } from "../../lib/categories";

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
          const categoryLabel =
            CATEGORIES.find((c) => c.key === category)?.label ?? null;
          const accent = getAccent(index);
          const price = lowestOfferPrice(project);
          const rawLogo = cleanLogoUrl(project.business_profile?.logo_url);
          const logoUrl = rawLogo && !failedLogos.has(project.id) ? rawLogo : null;
          // Title/host mapping: a project has one business name plus an
          // optional description. When a description exists it's the bold
          // "show title" and the business name is the seller (host row).
          // When it does NOT, the business name becomes the title and the
          // host-row name is hidden (avatar only), so the name never renders
          // twice on the same card.
          const businessName = project.title || project.name || "Untitled";
          const description = project.description?.trim() || "";
          const hasDescription = description.length > 0;

          return (
            <Link
              key={project.id}
              href={`/project/${project.slug || project.id}?live=1`}
              className="group flex w-[280px] flex-shrink-0 flex-col"
              style={{ scrollSnapAlign: "start" }}
            >
              {/* ── Host row above the thumbnail (Whatnot anatomy) ──
                  Avatar + seller name. The name is the seller label and
                  always shows here; the show title (description) sits
                  below the thumbnail, so the two never duplicate. Reuses
                  logo_url with the emoji fallback. */}
              <div className="mb-2 flex items-center gap-2">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={`${businessName} logo`}
                    loading="lazy"
                    onError={() => {
                      setFailedLogos((prev) => {
                        if (prev.has(project.id)) return prev;
                        const next = new Set(prev);
                        next.add(project.id);
                        return next;
                      });
                    }}
                    className="h-6 w-6 flex-shrink-0 rounded-full border border-default object-cover"
                  />
                ) : (
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm">
                    {emoji}
                  </span>
                )}
                <span className="truncate text-xs font-semibold text-primary">
                  {businessName}
                </span>
              </div>

              {/* ── Thumbnail with overlaid LIVE pill ──
                  The actual show plays muted on the first
                  MAX_AUTOPLAY_PREVIEWS cards (pointer-events-none so every
                  tap falls through to the Link and lands on the storefront
                  watch view); the rest show a static logo/emoji thumbnail.
                  Autoplay behavior + the cap are unchanged. */}
              <div className="relative overflow-hidden rounded-xl">
                {index < MAX_AUTOPLAY_PREVIEWS ? (
                  <div className="pointer-events-none">
                    <IVSStageViewer projectId={project.id} userId="" preview />
                  </div>
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-black">
                    {logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={logoUrl}
                        alt={`${project.title || project.name || "Business"} thumbnail`}
                        loading="lazy"
                        onError={() => {
                          setFailedLogos((prev) => {
                            if (prev.has(project.id)) return prev;
                            const next = new Set(prev);
                            next.add(project.id);
                            return next;
                          });
                        }}
                        className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100"
                      />
                    ) : (
                      <span className="text-5xl">{emoji}</span>
                    )}
                  </div>
                )}

                {/* LIVE pill — solid red pill (state-live token), top-left
                    over the thumbnail. Built as a flex row (dot + LIVE) so a
                    REAL concurrent-viewer count can drop in as a "· {count}"
                    span without restructuring.
                    TODO(viewer-count): once a real viewer count is on the
                    project data (AWS IVS, Phase 1), append after LIVE:
                      <span className="text-[10px] font-bold text-white">· {count}</span>
                    Never render a placeholder number — doctrine Rule #2
                    (no fake data). */}
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-[var(--state-live)] px-2 py-0.5 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white">
                    LIVE
                  </span>
                </div>
              </div>

              {/* ── Title + meta below the thumbnail ── */}
              <div className="mt-2 flex flex-col">
                {hasDescription && (
                  <h3 className="line-clamp-2 text-sm font-bold leading-snug text-primary transition group-hover:text-brand-teal">
                    {description}
                  </h3>
                )}
                {/* Meta row — category in an accent color, price beside it
                    (Whatnot's "Watches · $1 Starts" line). */}
                <div className="mt-1 flex items-center gap-1.5 text-xs">
                  {categoryLabel && (
                    <span className="font-semibold text-brand-teal">
                      {categoryLabel}
                    </span>
                  )}
                  {categoryLabel && price != null && (
                    <span className="text-muted">·</span>
                  )}
                  {price != null && (
                    <span className="font-medium text-secondary">
                      From ${price < 1 ? price.toFixed(2) : Math.round(price)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}

        {overflowCount > 0 && (
          <Link
            href="/discover?live=1"
            className="group flex w-[280px] flex-shrink-0 flex-col"
            style={{ scrollSnapAlign: "start" }}
          >
            {/* spacer to align the tile with the host row above each card */}
            <div className="mb-2 h-6" />
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-xl border border-[var(--state-live)]/30 bg-surface-card transition group-hover:border-[var(--state-live)]/50">
              <span className="text-lg font-bold text-primary">
                +{overflowCount} more
              </span>
              <span className="text-[10px] font-medium text-[var(--state-live)]">
                See all live →
              </span>
            </div>
          </Link>
        )}
      </div>
    </section>
  );
}
