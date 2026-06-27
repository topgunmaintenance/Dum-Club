"use client";

/**
 * ListingCard — buyer-facing shop card for the Club home / discover grid.
 *
 * Offer-forward (Option B): a small avatar + shop name header, then the card
 * body is the shop's featured offer — image (or a clean mint tile, never a
 * full-card letter), offer title, and price — with the LIVE / DEAL state on
 * the thumbnail. CTA reflects state: Watch live → / Shop the deal → / Shop
 * now →, and "Ask for a price" only when the shop has no priced offer.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { cleanLogoUrl } from "../../lib/imageSrc";
import type { Project, MarketSnapshot } from "../../lib/discover/types";
import { getAccent, lowestOfferPrice, hasOffers, offerCount } from "../../lib/discover/filters";
import { resolveCategoryLabel } from "../../lib/categories";
import { FollowButton } from "../FollowButton";

type ListingCardProps = {
  project: Project;
  index: number;
  marketSnapshot?: MarketSnapshot;
  isPulsing?: boolean;
  followerCount?: number;
  isFollowing?: boolean;
};

export function ListingCard({ project, index, isPulsing, followerCount = 0, isFollowing = false }: ListingCardProps) {
  const offers = offerCount(project);

  // Shop avatar (logo) — small, in the header row.
  const initialLogo = cleanLogoUrl(project.business_profile?.logo_url);
  const [logoSrc, setLogoSrc] = useState<string | null>(initialLogo);
  useEffect(() => { setLogoSrc(initialLogo); }, [initialLogo]);

  // Featured offer (store_items JSONB) drives the card body. Prefer a priced
  // item; fall back to the first. Image cascades offer-image -> shop cover ->
  // clean mint tile.
  const featuredOffer: Record<string, unknown> | null =
    Array.isArray(project.store_items) && project.store_items.length
      ? (project.store_items.find((i: Record<string, unknown>) => Number(i?.price_usd ?? i?.price ?? 0) > 0) || project.store_items[0])
      : null;
  const offerImage = cleanLogoUrl(
    (featuredOffer?.image as string) ||
      (featuredOffer?.primary_image_url as string) ||
      (featuredOffer?.image_url as string) ||
      project.business_profile?.cover_image_url,
  );
  const [mediaSrc, setMediaSrc] = useState<string | null>(offerImage);
  useEffect(() => { setMediaSrc(offerImage); }, [offerImage]);

  // Hooks must stay above this guard (Rules of Hooks).
  if (!hasOffers(project) && !project.verified) return null;

  const accent = getAccent(index);
  const categoryLabel = resolveCategoryLabel(project);
  const price = lowestOfferPrice(project);
  const isLive = project.is_live === true;
  const hasDeal = !!project.promo_copy;
  const href = `/project/${project.slug || project.id}${isLive ? "?live=1" : ""}`;
  const businessName = project.title || project.name || "Untitled";
  const monogram = (businessName.trim().charAt(0) || "•").toUpperCase();
  const offerTitle =
    ((featuredOffer?.title as string) || (featuredOffer?.name as string) || "").trim() ||
    project.description?.trim() ||
    "";

  const cta = isLive
    ? "Watch live →"
    : price != null || offers > 0
      ? hasDeal
        ? "Shop the deal →"
        : "Shop now →"
      : "Ask for a price →";

  return (
    <Link href={href} className="group block">
      <div
        className={`flex h-full flex-col overflow-hidden rounded-xl border bg-surface-card shadow-sm transition-all duration-200 ${
          isPulsing
            ? "border-brand-teal shadow-[0_0_16px_rgba(20,184,154,0.18)]"
            : "border-default hover:border-strong hover:-translate-y-0.5 hover:shadow-md"
        }`}
      >
        {/* Seller row — small avatar + name + verified + Follow */}
        <div className="flex items-center gap-2 px-3 pt-3">
          <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="" loading="lazy" onError={() => setLogoSrc(null)} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[11px] font-bold text-mint-text">{monogram}</span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-primary">{businessName}</span>
          {project.verified && (
            <span
              className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-full border border-default bg-brand-teal-soft px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-mint-text"
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

        {/* Media — featured offer image / shop cover, else a clean mint tile
            (small monogram + name, never a full-card letter). */}
        <div className="relative mx-3 mt-2.5 aspect-[4/3] overflow-hidden rounded-lg">
          {mediaSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc}
              alt={offerTitle || businessName}
              loading="lazy"
              onError={() => setMediaSrc(null)}
              className="block h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-brand-teal-soft to-surface-muted">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-card text-base font-extrabold text-mint-text shadow-sm">
                {monogram}
              </span>
              <span className="max-w-[80%] truncate text-[11px] font-semibold text-secondary">{businessName}</span>
            </div>
          )}

          {/* LIVE / DEAL state on the thumbnail */}
          {isLive ? (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-state-live px-2 py-0.5 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              <span className="text-[9px] font-bold uppercase tracking-wide text-white">Live</span>
            </span>
          ) : hasDeal ? (
            <span className="absolute left-2 top-2 rounded-full bg-mint-fill px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-mint-fill-ink shadow-sm">
              Deal
            </span>
          ) : null}
        </div>

        {/* Body — category eyebrow + featured offer title + price/CTA */}
        <div className="flex flex-1 flex-col px-3 pb-3 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: accent }}>
            {categoryLabel}
          </span>
          <p className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-primary">
            {offerTitle || "Tap to see what they offer"}
          </p>

          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <div className="flex flex-col">
              {price != null ? (
                <>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-secondary">From</span>
                  <span className="font-mono text-base font-extrabold text-mint-text">
                    ${price < 1 ? price.toFixed(2) : Math.round(price)}
                  </span>
                </>
              ) : (
                <span className="text-[10px] uppercase tracking-[0.12em] text-secondary">Ask for a price</span>
              )}
            </div>
            <span className={`text-[11px] font-bold transition ${isLive ? "text-state-live" : "text-secondary group-hover:text-mint-text"}`}>
              {cta}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
