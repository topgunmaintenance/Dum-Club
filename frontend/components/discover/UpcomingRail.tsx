"use client";

/**
 * Upcoming Rail — horizontal scroll of scheduled-but-not-yet-live sellers.
 *
 * Renders ONLY when at least one project has a FUTURE scheduled_live_at and
 * isn't already live. Returns null otherwise — so it stays invisible until a
 * merchant actually schedules a show (never a fabricated or empty placeholder,
 * per CLAUDE.md §12 Rule 2).
 *
 * This is the honest substitute for Whatnot's always-on live grid: when
 * nothing is live right now, scheduled shows keep the feed energetic. The
 * countdown ("Live in 2h 15m") and local start time are computed from the
 * real projects.scheduled_live_at column (migration 064).
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { getProjectEmoji, getAccent, lowestOfferPrice } from "../../lib/discover/filters";

const MAX_UPCOMING_CARDS = 12;

// Parse projects.scheduled_live_at (Postgres timestamptz) to epoch ms. Same
// Safari-safe normalization as the live timer/sort (space -> T, microsecond
// trim, 2-digit-offset pad). Returns NaN when absent/unparseable.
function scheduledMs(p: Project): number {
  const raw = p.scheduled_live_at;
  if (!raw) return NaN;
  const iso = raw
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(iso);
}

// "Live in 2d 3h" / "Live in 3h 15m" / "Live in 45m" / "Starting soon".
function countdownLabel(startMs: number, nowMs: number): string {
  const diff = startMs - nowMs;
  if (diff <= 60_000) return "Starting soon";
  const mins = Math.floor(diff / 60_000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days > 0) return `Live in ${days}d ${hrs}h`;
  if (hrs > 0) return `Live in ${hrs}h ${m}m`;
  return `Live in ${m}m`;
}

// Absolute local start, e.g. "Today 7:00 PM" / "Sat 7:00 PM".
function localWhen(startMs: number, nowMs: number): string {
  const d = new Date(startMs);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

export function UpcomingRail({ projects }: { projects: Project[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [failedLogos, setFailedLogos] = useState<Set<string>>(() => new Set());

  // Upcoming = real future scheduled_live_at, not currently live, soonest
  // first. A show whose start time has passed (but the seller hasn't gone
  // live) drops out rather than showing a negative countdown.
  const upcoming = projects
    .filter((p) => p.is_live !== true)
    .map((p) => ({ p, ms: scheduledMs(p) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms > now)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, MAX_UPCOMING_CARDS);

  // Minute-precision tick; only armed while something is upcoming. Above the
  // early return to keep hook order stable (Rules of Hooks).
  useEffect(() => {
    if (upcoming.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, [upcoming.length]);

  if (upcoming.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden="true" className="text-sm">🗓️</span>
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-primary">
          Upcoming Live
        </h2>
        <span className="rounded-full bg-brand-teal-soft px-2 py-0.5 text-[10px] font-bold text-brand-navy">
          {upcoming.length}
        </span>
      </div>

      <div
        className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {upcoming.map(({ p, ms }, index) => {
          const emoji = getProjectEmoji(p, index);
          const price = lowestOfferPrice(p);
          const rawLogo = cleanLogoUrl(p.business_profile?.logo_url);
          const logoUrl = rawLogo && !failedLogos.has(p.id) ? rawLogo : null;
          const businessName = p.title || p.name || "Untitled";
          const description = p.description?.trim() || "";
          const cardTitle = description.length > 0 ? description : businessName;

          return (
            <Link
              key={p.id}
              href={`/project/${p.slug || p.id}`}
              className="flex w-[280px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-default bg-surface-card transition hover:border-strong"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="relative">
                <div className="flex aspect-video w-full items-center justify-center overflow-hidden bg-surface-muted">
                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoUrl}
                      alt={`${businessName} thumbnail`}
                      loading="lazy"
                      onError={() =>
                        setFailedLogos((prev) => {
                          if (prev.has(p.id)) return prev;
                          const next = new Set(prev);
                          next.add(p.id);
                          return next;
                        })
                      }
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-5xl">{emoji}</span>
                  )}
                </div>

                {/* Countdown pill — real time-to-go-live from scheduled_live_at. */}
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-full bg-brand-navy px-2 py-0.5 shadow-sm">
                  <span aria-hidden="true" className="text-[10px]">⏱</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white">
                    {countdownLabel(ms, now)}
                  </span>
                </div>
              </div>

              <div className="flex flex-1 flex-col p-3">
                <h3 className="line-clamp-2 text-sm font-bold leading-snug text-primary">
                  {cardTitle}
                </h3>
                <div className="mt-1 text-[11px] font-medium text-secondary">
                  {localWhen(ms, now)}
                </div>
                <div className="mt-auto flex items-center justify-between pt-3">
                  {price != null && (
                    <span className="text-xs font-bold text-brand-teal">
                      From ${price < 1 ? price.toFixed(2) : Math.round(price)}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] font-medium text-brand-navy">
                    Set a reminder →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
