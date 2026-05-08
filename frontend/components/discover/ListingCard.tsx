"use client";

/**
 * ListingCard — buyer-facing merchant card for /discover grid.
 *
 * Pass 1 strict rules:
 * - No profile strength, no rankings, no Top N
 * - No ratings, sold counts, distances, or DUM points
 * - No Mux autoplay (thumbnail + badge only)
 * - Card does not render if offersCount === 0
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project, MarketSnapshot } from "../../lib/discover/types";
import {
  getProjectEmoji,
  getAccent,
  lowestOfferPrice,
  hasOffers,
  hasSubscription,
  offerCount,
} from "../../lib/discover/filters";
import { classifyProject, type CategoryId } from "../../lib/categories";

const ALLOWED_CATEGORIES: CategoryId[] = [
  "auto", "home", "beauty", "restaurants", "aviation", "pets", "health", "entertainment",
];

const CATEGORY_LABELS: Record<CategoryId, string> = {
  auto: "Auto",
  home: "Home",
  beauty: "Beauty",
  restaurants: "Restaurants",
  aviation: "Aviation",
  pets: "Pets",
  health: "Health",
  entertainment: "Entertainment",
};

function RelativeTime({ dateStr }: { dateStr?: string | null }) {
  const [label, setLabel] = useState("—");

  useEffect(() => {
    if (!dateStr) { setLabel("—"); return; }
    function update() {
      const t = new Date(dateStr!).getTime();
      if (Number.isNaN(t)) { setLabel("—"); return; }
      const diff = Date.now() - t;
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      if (mins < 1) setLabel("just now");
      else if (mins < 60) setLabel(`${mins}m ago`);
      else if (hrs < 24) setLabel(`${hrs}h ago`);
      else setLabel(`${Math.floor(hrs / 24)}d ago`);
    }
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [dateStr]);

  return <span className="font-mono text-[9px] text-zinc-600">{label}</span>;
}

/**
 * Deterministic gradient from project ID hash.
 * Used when no thumbnail exists (most projects in Pass 1).
 */
function idGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1},40%,15%), hsl(${h2},30%,10%))`;
}

type ListingCardProps = {
  project: Project;
  index: number;
  marketSnapshot?: MarketSnapshot;
  isPulsing?: boolean;
};

export function ListingCard({ project, index, marketSnapshot, isPulsing }: ListingCardProps) {
  const offers = offerCount(project);

  // Card should not render without offers (filtered upstream, but guard).
  // Verified founding merchants bypass: their offers live in the `offers`
  // table, not store_items JSONB — the card still renders, just without
  // the "N offers" badge and price label. Mirrors isDiscoverable() and
  // /api/projects/public Pass 2 contract.
  if (offers === 0 && !project.verified) return null;

  const emoji = getProjectEmoji(project, index);
  const accent = getAccent(index);
  const category = classifyProject(project);
  const categoryLabel = ALLOWED_CATEGORIES.includes(category) ? CATEGORY_LABELS[category] : null;
  const price = lowestOfferPrice(project);
  const isLive = project.is_live === true;
  const href = `/project/${project.slug || project.id}${isLive ? "?live=1" : ""}`;

  return (
    <Link href={href} className="group block">
      <div
        className={`flex h-full flex-col rounded-xl border p-5 transition-all duration-200 sm:p-6 ${
          isPulsing
            ? "border-emerald-400/50 shadow-[0_0_12px_rgba(52,211,153,0.12)]"
            : isLive
              ? "border-red-500/20 hover:border-red-500/40"
              : "border-zinc-800/70 hover:border-zinc-700 hover:-translate-y-0.5"
        } bg-zinc-950/60`}
      >
        {/* Thumbnail area */}
        <div
          className="mb-4 flex h-20 items-center justify-center rounded-lg"
          style={{ background: idGradient(project.id) }}
        >
          <span className="text-3xl">{emoji}</span>
        </div>

        {/* Header: category + live badge.
            Audit #5 Phase 1 (Q4) — promoted LIVE pill from h-1.5 / text-[9px]
            with no fill to a fuller red pill so the live signal stops
            getting scanned past at a glance. Same restraint, stronger
            visibility. */}
        <div className="mb-2 flex items-center justify-between gap-2">
          {categoryLabel && (
            <span
              className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.08em]"
              style={{ borderColor: accent, color: accent }}
            >
              {categoryLabel}
            </span>
          )}
          {isLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">LIVE</span>
            </span>
          )}
        </div>

        {/* Title — verified merchants get a small emerald check next
            to the name (Q2). Source: project.verified — same field
            used by the storefront page header. */}
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-base font-bold text-white sm:text-lg">
            {project.title || project.name || "Untitled"}
          </h3>
          {project.verified && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400"
              title="Verified merchant"
              aria-label="Verified merchant"
            >
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 16 16" aria-hidden="true">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" />
              </svg>
              Verified
            </span>
          )}
        </div>

        {/* Description */}
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-zinc-500">
          {project.description || "No description yet."}
        </p>

        {/* Badges */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {offers > 0 && (
            <span className="rounded-full border border-sky-400/20 bg-sky-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-sky-400">
              {offers} offer{offers > 1 ? "s" : ""}
            </span>
          )}
          {hasSubscription(project) && (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
              Subscription
            </span>
          )}
          {project.promo_copy && (
            <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-amber-400">
              Promo
            </span>
          )}
        </div>

        {/* Footer: CTA + price + timestamp */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-zinc-800/50 pt-4 mt-4">
          <span className="text-[11px] font-medium text-zinc-400 transition group-hover:text-emerald-400">
            {isLive ? "Watch live →" : "Shop now →"}
          </span>
          <div className="flex items-center gap-2">
            {price != null && (
              <span className="text-sm font-bold text-emerald-400">
                From ${price < 1 ? price.toFixed(2) : Math.round(price)}
              </span>
            )}
            <RelativeTime dateStr={project.created_at} />
          </div>
        </div>
      </div>
    </Link>
  );
}
