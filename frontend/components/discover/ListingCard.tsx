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
import { classifyProject, resolveCategoryLabel } from "../../lib/categories";

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

  return <span className="font-mono text-[9px] text-secondary">{label}</span>;
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

  // Card should not render without offers (filtered upstream by
  // filterProjects + isDiscoverable, but kept as a defensive guard).
  // Reads hasOffers which honors both sources after PR #374: the modern
  // active_offer_count enriched onto the project payload and the legacy
  // store_items JSONB. Verified founding merchants bypass entirely so
  // the verified badge always renders even on a zero-offer card.
  if (!hasOffers(project) && !project.verified) return null;

  const emoji = getProjectEmoji(project, index);
  const accent = getAccent(index);
  // categoryId still drives the CTA branch below (auto/home/beauty/etc).
  // categoryLabel is now the SOURCE-OF-TRUTH human label: prefers the
  // canonical seeded category_id, falls back to the keyword classifier
  // so pre-mig-035 projects keep their existing badge.
  const categoryId = classifyProject(project);
  const categoryLabel = resolveCategoryLabel(project);
  // logoSrc mirrors business_profile.logo_url on load and resets to
  // null on <img> onError below. This keeps the emoji+gradient
  // fallback robust against broken seed data / missing CDN assets:
  // a 404 or decode failure flips this card back to the existing
  // text+emoji avatar without losing the rest of the card. The
  // useEffect resets the source when the project's logo URL changes
  // so a card recycled into a new project via list virtualisation
  // can't pin a prior project's failure on the next one.
  const initialLogo = (project.business_profile?.logo_url || "").trim() || null;
  const [logoSrc, setLogoSrc] = useState<string | null>(initialLogo);
  useEffect(() => {
    setLogoSrc(initialLogo);
  }, [initialLogo]);
  const price = lowestOfferPrice(project);
  const isLive = project.is_live === true;
  const href = `/project/${project.slug || project.id}${isLive ? "?live=1" : ""}`;

  // Context-aware CTA per Phase 1 DC-2 of the Discover plan. Live
  // always wins; service categories prompt for a quote; restaurants
  // get an order CTA; entertainment maps to tickets; everything
  // else lands on the generic shop-now.
  const ctaLabel = isLive
    ? "Join live →"
    : categoryId === "restaurants"
      ? "Order now →"
      : categoryId === "entertainment"
        ? "Buy tickets →"
        : (
            categoryId === "auto" ||
            categoryId === "home" ||
            categoryId === "beauty" ||
            categoryId === "aviation" ||
            categoryId === "pets" ||
            categoryId === "health"
          )
          ? "Ask for a price →"
          : "Browse offers →";

  return (
    <Link href={href} className="group block">
      <div
        className={`flex h-full flex-col rounded-xl border bg-surface-card p-5 shadow-sm transition-all duration-200 sm:p-6 ${
          isPulsing
            ? "border-brand-teal shadow-[0_0_16px_rgba(20,184,154,0.18)]"
            : isLive
              ? "border-state-live/30 hover:border-state-live/50"
              : "border-default hover:border-strong hover:-translate-y-0.5 hover:shadow-md"
        }`}
      >
        {/* Thumbnail area — merchant logo when supplied, gradient + emoji
            fallback for every existing merchant who hasn't uploaded one.
            Backwards-compat: a null logo_url renders the exact same
            avatar this card showed before P3. */}
        <div
          className="mb-4 flex h-20 items-center justify-center overflow-hidden rounded-lg"
          style={logoSrc ? undefined : { background: idGradient(project.id) }}
        >
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt={`${project.title || project.name || "Business"} logo`}
              loading="lazy"
              onError={() => setLogoSrc(null)}
              className="block h-full w-full object-cover"
            />
          ) : (
            <span className="text-3xl">{emoji}</span>
          )}
        </div>

        {/* Header: category + live badge. resolveCategoryLabel() always
            returns a string, so the category pill always renders — no
            more "BUSINESS · BUSINESS" generic dead-end. */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.08em]"
            style={{ borderColor: accent, color: accent }}
          >
            {categoryLabel}
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-state-live/40 bg-state-live/10 px-2 py-0.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-state-live" />
              </span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-state-live">
                Live now
                {typeof (project as { viewer_count?: number }).viewer_count === "number" &&
                ((project as { viewer_count?: number }).viewer_count || 0) > 0
                  ? ` · ${(project as { viewer_count?: number }).viewer_count} watching`
                  : ""}
              </span>
            </span>
          )}
        </div>

        {/* Title — verified merchants get the brand-teal check pill.
            line-clamp-2 instead of truncate so multi-word names like
            "Topgun Maintenance" wrap to a second line rather than
            getting chopped mid-word in the marketplace grid. */}
        <div className="flex items-start gap-1.5">
          <h3 className="line-clamp-2 text-base font-bold text-primary sm:text-lg">
            {project.title || project.name || "Untitled"}
          </h3>
          {project.verified && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-default bg-brand-teal-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-brand-navy"
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
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-secondary">
          {project.description || "No description yet."}
        </p>

        {/* Badges */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {offers > 0 && (
            <span className="rounded-full border border-default bg-surface-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-navy">
              {offers} offer{offers > 1 ? "s" : ""}
            </span>
          )}
          {hasSubscription(project) && (
            <span className="rounded-full border border-default bg-brand-teal-soft px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-navy">
              Subscription
            </span>
          )}
          {project.promo_copy && (
            <span className="rounded-full border border-default bg-surface-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-brand-navy">
              Promo
            </span>
          )}
        </div>

        {/* Footer: price (primary) + CTA / timestamp (secondary). */}
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-default pt-4 mt-4">
          <div className="flex flex-col">
            {price != null ? (
              <>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-secondary">
                  From
                </span>
                <span className="font-mono text-lg font-extrabold text-brand-navy">
                  ${price < 1 ? price.toFixed(2) : Math.round(price)}
                </span>
              </>
            ) : (
              <span className="text-[10px] uppercase tracking-[0.12em] text-secondary">
                Ask for a price
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] font-medium text-secondary transition group-hover:text-brand-teal">
              {ctaLabel}
            </span>
            <RelativeTime dateStr={project.created_at} />
          </div>
        </div>
      </div>
    </Link>
  );
}
