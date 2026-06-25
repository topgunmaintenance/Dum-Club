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
 * already reads live=1 and switches to live-only). Ordering is
 * most-recently-live-first by projects.live_started_at DESC
 * (migration 084); rows with no live_started_at (went live before
 * the column existed) sort last, keeping their feed-order position.
 */

import { useState, useEffect } from "react";
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

// Parse projects.live_started_at (Postgres timestamptz) to epoch ms for
// ordering. Normalizes the space-separated / 2-digit-offset form PostgREST
// can return (e.g. "2026-06-17 03:04:59.07+00") to ISO 8601 before Date.parse
// — strict engines (Safari) otherwise read it as NaN. Missing or unparseable
// sorts last (-Infinity, so a DESC sort drops it to the bottom).
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

// "H:MM" elapsed since the broadcast started, for the LIVE pill (migration
// 084). Reuses liveStartedMs for the same Safari-safe timestamp parsing.
// Returns null when live_started_at is absent/unparseable (pre-column stream)
// so the pill simply shows "LIVE" with no timer — never a fabricated time.
function liveForLabel(p: Project, nowMs: number): string | null {
  const startMs = liveStartedMs(p);
  if (!Number.isFinite(startMs)) return null;
  const mins = Math.max(0, Math.floor((nowMs - startMs) / 60000));
  return `${Math.floor(mins / 60)}:${(mins % 60).toString().padStart(2, "0")}`;
}

export function LiveRail({ projects }: { projects: Project[] }) {
  // Most-recently-live first (migration 084). Null-safe: a missing
  // live_started_at resolves to -Infinity, so pre-column live rows sort to
  // the bottom and keep their relative feed-order.
  const liveProjects = projects
    .filter((p) => p.is_live === true)
    .sort((a, b) => liveStartedMs(b) - liveStartedMs(a));
  const visibleProjects = liveProjects.slice(0, MAX_LIVE_CARDS);
  const overflowCount = liveProjects.length - visibleProjects.length;
  // Project IDs whose <img> failed to load. We keep this at the rail
  // level (rather than per-card local state) so we don't have to
  // extract every card into its own component just to host one piece
  // of fallback state. On failure, the project ID is added and the
  // card flips back to the emoji avatar — same backwards-compat
  // behavior as ListingCard's per-card state.
  const [failedLogos, setFailedLogos] = useState<Set<string>>(() => new Set());
  // Ticking clock for the "LIVE · H:MM" pill timers. One interval for the
  // whole rail (not per card); only armed while something is live. Must sit
  // above the early return below to keep hook order stable (Rules of Hooks).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (liveProjects.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [liveProjects.length]);
  if (liveProjects.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-state-live" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">
          Live Now
        </h2>
        <span className="rounded-full bg-state-live/15 px-2 py-0.5 text-[10px] font-bold text-state-live">
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
          // Title/host mapping: a project has one business name plus an
          // optional description. When a description exists it's the bold
          // "show title" and the business name is the seller (host row).
          // When it does NOT, the business name becomes the title and the
          // host-row name is hidden (avatar only), so the name never renders
          // twice on the same card.
          const businessName = project.title || project.name || "Untitled";
          const description = project.description?.trim() || "";
          const hasDescription = description.length > 0;
          const cardTitle = hasDescription ? description : businessName;
          const liveFor = liveForLabel(project, now);

          return (
            <Link
              key={project.id}
              href={`/project/${project.slug || project.id}?live=1`}
              className="flex w-[280px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--state-live)]/30 bg-surface-card transition hover:border-[var(--state-live)]/50"
              style={{ scrollSnapAlign: "start" }}
            >
              {/* ── Thumbnail with overlaid LIVE pill ──
                  The actual show plays muted on the first
                  MAX_AUTOPLAY_PREVIEWS cards (pointer-events-none so every
                  tap falls through to the Link and lands on the storefront
                  watch view); the rest show a static logo/emoji thumbnail.
                  Autoplay behavior + the cap are unchanged — this only
                  wraps the preview so the pill can overlay it. */}
              <div className="relative">
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
                        className="h-full w-full object-cover opacity-90"
                      />
                    ) : (
                      <span className="text-5xl">{emoji}</span>
                    )}
                  </div>
                )}

                {/* LIVE pill — single solid red pill, top-left over the
                    thumbnail. Built as a flex row (dot + LIVE) so a live
                    viewer count can drop in later as a "• {count}" span
                    without restructuring.
                    TODO(viewer-count): once a live viewer count is on the
                    project data, append here:
                      <span className="text-[10px] font-bold text-white">• {count}</span> */}
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-state-live px-2 py-0.5 shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white">
                    LIVE
                  </span>
                  {/* Real elapsed since go-live (migration 084). Hidden when
                      live_started_at is absent so a pre-column stream shows a
                      plain "LIVE" pill — never a fabricated time. */}
                  {liveFor && (
                    <span
                      className="text-[10px] font-bold text-white/90"
                      title={`Live for ${liveFor}`}
                    >
                      · {liveFor}
                    </span>
                  )}
                </div>
              </div>

              {/* ── Card body ── */}
              <div className="flex flex-1 flex-col p-3">
                {/* Bold title — prominent, max two lines. */}
                <h3 className="line-clamp-2 text-sm font-bold leading-snug text-primary">
                  {cardTitle}
                </h3>

                {/* Host row — avatar + seller name (Whatnot shows the
                    seller under the thumbnail). The name renders only when a
                    description is serving as the title above; with no
                    description the business name IS the title, so we show
                    the avatar alone and never stack the name twice. Reuses
                    logo_url with the emoji fallback. */}
                <div className="mt-2 flex items-center gap-2">
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
                      className="h-6 w-6 flex-shrink-0 rounded-full border border-default object-cover"
                    />
                  ) : (
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm">
                      {emoji}
                    </span>
                  )}
                  {hasDescription && (
                    <span className="truncate text-xs font-medium text-secondary">
                      {businessName}
                    </span>
                  )}
                </div>

                {/* Footer — price + watch CTA */}
                <div className="mt-auto flex items-center justify-between pt-3">
                  {price != null && (
                    <span className="font-mono text-xs font-bold text-mint-text">
                      From ${price < 1 ? price.toFixed(2) : Math.round(price)}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-medium text-state-live">
                    Watch live →
                  </span>
                </div>
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
            <span className="text-[10px] font-medium text-state-live">
              See all live →
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}
