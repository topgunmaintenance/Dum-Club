"use client";

/**
 * ListingCard — buyer-facing merchant card for /discover grid.
 *
 * Pass 1 strict rules:
 * - No profile strength, no rankings, no Top N
 * - No ratings, sold counts, distances, or DUM points
 * - Portrait, seller-led media card (no Mux autoplay on the grid)
 * - Card does not render if offersCount === 0
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { cleanLogoUrl } from "../../lib/imageSrc";
import type { Project, MarketSnapshot } from "../../lib/discover/types";
import {
  getAccent,
  lowestOfferPrice,
  hasOffers,
  hasSubscription,
  offerCount,
} from "../../lib/discover/filters";
import { classifyProject, resolveCategoryLabel } from "../../lib/categories";
import { FollowButton } from "../FollowButton";

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


type ListingCardProps = {
  project: Project;
  index: number;
  marketSnapshot?: MarketSnapshot;
  isPulsing?: boolean;
  followerCount?: number;
  isFollowing?: boolean;
};

export function ListingCard({ project, index, marketSnapshot, isPulsing, followerCount = 0, isFollowing = false }: ListingCardProps) {
  const offers = offerCount(project);

  // logoSrc mirrors business_profile.logo_url on load and resets to
  // null on <img> onError below. This keeps the emoji+gradient
  // fallback robust against broken seed data / missing CDN assets:
  // a 404 or decode failure flips this card back to the existing
  // text+emoji avatar without losing the rest of the card. The
  // useEffect resets the source when the project's logo URL changes
  // so a card recycled into a new project via list virtualisation
  // can't pin a prior project's failure on the next one.
  //
  // These hooks MUST stay above the early-return guard below: a card can
  // flip between null and rendered (offers/verified change, or a recycled
  // virtualised card reused for a new project), and calling hooks after a
  // conditional return changes hook order between renders — Rules of Hooks,
  // which crashes React with "rendered fewer/more hooks than expected".
  const initialLogo = cleanLogoUrl(project.business_profile?.logo_url);
  const [logoSrc, setLogoSrc] = useState<string | null>(initialLogo);
  useEffect(() => {
    setLogoSrc(initialLogo);
  }, [initialLogo]);
  // coverSrc mirrors business_profile.cover_image_url (already on the
  // /api/projects/public feed). It leads the portrait media when present; a
  // failed load resets to null and the media falls back to the logo, then
  // the emoji+gradient — same recycle-safe pattern as logoSrc, and same
  // Rules-of-Hooks reason for living above the early-return guard.
  const initialCover = cleanLogoUrl(project.business_profile?.cover_image_url);
  const [coverSrc, setCoverSrc] = useState<string | null>(initialCover);
  useEffect(() => {
    setCoverSrc(initialCover);
  }, [initialCover]);

  // Card should not render without offers (filtered upstream by
  // filterProjects + isDiscoverable, but kept as a defensive guard).
  // Reads hasOffers which honors both sources after PR #374: the modern
  // active_offer_count enriched onto the project payload and the legacy
  // store_items JSONB. Verified founding merchants bypass entirely so
  // the verified badge always renders even on a zero-offer card.
  if (!hasOffers(project) && !project.verified) return null;

  const accent = getAccent(index);
  // categoryId still drives the CTA branch below (auto/home/beauty/etc).
  // categoryLabel is the SOURCE-OF-TRUTH human label: prefers the canonical
  // seeded category_id, falls back to the keyword classifier so pre-mig-035
  // projects keep their existing badge.
  const categoryId = classifyProject(project);
  const categoryLabel = resolveCategoryLabel(project);
  const price = lowestOfferPrice(project);
  const isLive = project.is_live === true;
  const href = `/project/${project.slug || project.id}${isLive ? "?live=1" : ""}`;
  const businessName = project.title || project.name || "Untitled";
  // Monogram fallback for merchants with no logo/cover — their initial on a
  // soft-mint tile, never a random emoji.
  const monogram = (businessName.trim().charAt(0) || "•").toUpperCase();

  // Context-aware CTA per Phase 1 DC-2 of the Discover plan. Service
  // categories prompt for a quote; restaurants get an order CTA;
  // entertainment maps to tickets; everything else lands on the
  // generic shop-now. The live CTA/badge lives in LiveRail — the single
  // live surface — so a live seller never renders twice with live treatment.
  const ctaLabel = categoryId === "restaurants"
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
        className={`flex h-full flex-col rounded-xl border bg-surface-card p-3 shadow-sm transition-all duration-200 sm:p-3.5 ${
          isPulsing
            ? "border-brand-teal shadow-[0_0_16px_rgba(20,184,154,0.18)]"
            : "border-default hover:border-strong hover:-translate-y-0.5 hover:shadow-md"
        }`}
      >
        {/* Seller row — avatar + business name + verified, ABOVE the media
            (Whatnot seller identity; folds in the deferred P2.5). Avatar reuses
            logoSrc with the mint monogram fallback; onError clears it. */}
        <div className="mb-2.5 flex items-center gap-2">
          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoSrc}
                alt=""
                loading="lazy"
                onError={() => setLogoSrc(null)}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-[11px] font-bold text-mint-text">{monogram}</span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-primary">
            {businessName}
          </span>
          {project.verified && (
            <span
              className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full border border-default bg-brand-teal-soft px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-brand-navy"
              title="Verified merchant"
              aria-label="Verified merchant"
            >
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 16 16" aria-hidden="true">
                <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l3.5 3.5L13 4" />
              </svg>
              Verified
            </span>
          )}
          <FollowButton projectId={project.id} initialCount={followerCount} initialFollowing={isFollowing} />
        </div>

        {/* Portrait media tile (4:5) — cover photo -> logo -> mint monogram.
            Bigger and more immersive than the prior 16:9 (Whatnot tiles are
            portrait). Each <img> degrades to the next source on error; a
            merchant with neither a cover nor a logo renders their initial on a
            soft-mint tile (never a random emoji). */}
        <div className="relative mb-2.5 aspect-[4/5] overflow-hidden rounded-lg">
          {coverSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc}
              alt={`${businessName} cover`}
              loading="lazy"
              onError={() => setCoverSrc(null)}
              className="block h-full w-full object-cover"
            />
          ) : logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc}
              alt={`${businessName} logo`}
              loading="lazy"
              onError={() => setLogoSrc(null)}
              className="block h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-brand-teal-soft">
              <span className="text-5xl font-extrabold text-mint-text">{monogram}</span>
            </div>
          )}

          {/* Deal ribbon — real promo_copy only (urgency, Whatnot-style). */}
          {project.promo_copy && (
            <span className="absolute left-2 top-2 rounded-full bg-brand-teal px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-navy shadow-sm">
              Deal
            </span>
          )}
        </div>

        {/* Category eyebrow (colored) */}
        <span className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: accent }}>
          {categoryLabel}
        </span>

        {/* Description — the "what they do" line */}
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-secondary">
          {project.description || "No description yet."}
        </p>

        {/* Secondary signals — offers count + subscription (kept, compact) */}
        {(offers > 0 || hasSubscription(project)) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
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
          </div>
        )}

        {/* Footer: price (primary) + CTA / timestamp (secondary). */}
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-default pt-3">
          <div className="flex flex-col">
            {price != null ? (
              <>
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-secondary">
                  From
                </span>
                <span className="font-mono text-base font-extrabold text-mint-text">
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
