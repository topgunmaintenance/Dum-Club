"use client";

/**
 * ListingCard — buyer-facing shop card for the Club home / discover grid.
 *
 * Business-card layout (handoff "Services & Businesses"): header row of a
 * rounded-square avatar + shop name + VERIFIED badge + Follow button, then a
 * featured image (or a clean mint tile, never a full-card letter), a mono
 * category tag, the shop's offer/description blurb, and a footer with "ASK FOR
 * A PRICE" (or a price) and a state-aware CTA: Watch live → / Shop the deal →
 * / Shop now → / Ask for a price →.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { cleanLogoUrl } from "../../lib/imageSrc";
import type { Project, MarketSnapshot } from "../../lib/discover/types";
import { lowestOfferPrice, hasOffers, offerCount } from "../../lib/discover/filters";
import { resolveCategoryLabel } from "../../lib/categories";
import { projectMatchesVerb } from "../../lib/discover/verbs";
import { FollowButton } from "../FollowButton";

type ListingCardProps = {
  project: Project;
  index: number;
  marketSnapshot?: MarketSnapshot;
  isPulsing?: boolean;
  followerCount?: number;
  isFollowing?: boolean;
};

/**
 * Category tag accent — fixed two-color palette from the handoff
 * (aviation/services green, pro-services amber). Never a free-picked color:
 * professional-services-style shops ("Book" verb) read amber, everything else
 * reads emerald, matching the design's tag treatment.
 */
function categoryTagClass(project: Project): string {
  return projectMatchesVerb(project, "book") ? "text-dum-amber" : "text-mint-text";
}

export function ListingCard({ project, index, isPulsing, followerCount = 0, isFollowing = false }: ListingCardProps) {
  const offers = offerCount(project);

  // Shop avatar (logo) — small, in the header row.
  const initialLogo = cleanLogoUrl(project.business_profile?.logo_url);
  const [logoSrc, setLogoSrc] = useState<string | null>(initialLogo);
  useEffect(() => { setLogoSrc(initialLogo); }, [initialLogo]);

  // Featured offer (store_items JSONB) drives the card image. Prefer a priced
  // item; fall back to the first. Image cascades offer-image -> shop cover ->
  // clean mint tile.
  const featuredOffer: Record<string, unknown> | null =
    Array.isArray(project.store_items) && project.store_items.length
      ? (project.store_items.find((i: Record<string, unknown>) => Number(i?.price_usd ?? i?.price ?? 0) > 0) || project.store_items[0])
      : null;
  const offerImage = cleanLogoUrl(
    // Server-computed featured image first — offers-table storefronts have
    // empty store_items JSONB, so this is the field that actually fills
    // real merchants' cards. Then the legacy JSONB cascade, the shop
    // cover, and finally the logo: founding shops often uploaded a real
    // photo as their "logo", and any photo beats a blank mint tile.
    project.featured_offer_image ||
      (featuredOffer?.image as string) ||
      (featuredOffer?.primary_image_url as string) ||
      (featuredOffer?.image_url as string) ||
      project.business_profile?.cover_image_url ||
      project.business_profile?.logo_url,
  );
  const [mediaSrc, setMediaSrc] = useState<string | null>(offerImage);
  useEffect(() => { setMediaSrc(offerImage); }, [offerImage]);

  // Hooks must stay above this guard (Rules of Hooks).
  if (!hasOffers(project) && !project.verified) return null;

  const categoryLabel = resolveCategoryLabel(project);
  const tagClass = categoryTagClass(project);
  const price = lowestOfferPrice(project);
  const isLive = project.is_live === true;
  const hasDeal = !!project.promo_copy;
  const href = `/project/${project.slug || project.id}${isLive ? "?live=1" : ""}`;
  const businessName = project.title || project.name || "Untitled";
  const monogram = (businessName.trim().charAt(0) || "•").toUpperCase();
  // Blurb under the tag — the shop's own description, falling back to its
  // featured offer title so the card never reads empty.
  const blurb =
    project.description?.trim() ||
    ((featuredOffer?.title as string) || (featuredOffer?.name as string) || "").trim() ||
    "";

  const cta = isLive
    ? "Watch live →"
    : price != null || offers > 0
      ? hasDeal
        ? "Shop the deal →"
        : "Shop now →"
      : "Ask for a price →";

  return (
    <Link href={href} className="group block min-w-0">
      <div
        className={`flex h-full flex-col rounded-2xl border bg-surface-card p-4 transition-all duration-200 ${
          isPulsing
            ? "border-mint-text shadow-dum-elev"
            : "border-default shadow-dum-card hover:border-strong hover:-translate-y-0.5 hover:shadow-dum-elev"
        }`}
      >
        {/* Header row — rounded-square avatar + name + VERIFIED + Follow */}
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default bg-mint-card">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt="" loading="lazy" onError={() => setLogoSrc(null)} className="h-full w-full object-cover" />
            ) : (
              <span className="text-[13px] font-bold text-mint-text">{monogram}</span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-primary">{businessName}</span>
          {project.verified && (
            <span
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-mint-card px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-mint-text"
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
        <div className="relative mt-3 h-[150px] overflow-hidden rounded-xl">
          {mediaSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaSrc}
              alt={blurb || businessName}
              loading="lazy"
              onError={() => setMediaSrc(null)}
              className="block h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-mint-card to-surface-muted">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-card text-base font-extrabold text-mint-text shadow-sm">
                {monogram}
              </span>
              <span className="max-w-[80%] truncate text-[11px] font-semibold text-secondary">{businessName}</span>
            </div>
          )}

          {/* LIVE / DEAL state on the thumbnail */}
          {isLive ? (
            <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-coral px-2 py-0.5 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-white">Live</span>
            </span>
          ) : hasDeal ? (
            <span className="absolute left-2.5 top-2.5 rounded-md bg-mint-fill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mint-fill-ink shadow-sm">
              Deal
            </span>
          ) : null}
        </div>

        {/* Body — mono category tag + blurb */}
        <div className="mt-3 flex flex-1 flex-col">
          <span className={`font-mono text-[11px] font-medium uppercase tracking-[0.06em] ${tagClass}`}>
            {categoryLabel}
          </span>
          <p className="mt-1.5 line-clamp-3 text-[14px] font-semibold leading-snug text-primary">
            {blurb || "Tap to see what they offer"}
          </p>

          {/* Footer — ASK FOR A PRICE (or price) + state-aware CTA */}
          <div className="mt-auto flex items-center justify-between gap-3 border-t border-default pt-3.5">
            {price != null ? (
              <span className="font-mono text-[15px] font-extrabold text-mint-text">
                ${price < 1 ? price.toFixed(2) : Math.round(price)}
              </span>
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Ask for a price</span>
            )}
            <span className={`text-[14px] font-bold transition ${isLive ? "text-coral" : "text-primary group-hover:text-mint-text"}`}>
              {cta}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
