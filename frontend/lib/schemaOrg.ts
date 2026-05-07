/**
 * Schema.org JSON-LD builders. Pure functions, no I/O.
 *
 * Why this exists:
 *   AI crawlers (Claude, GPT, Perplexity, Gemini) and Google rich
 *   results parse <script type="application/ld+json"> natively. By
 *   emitting Schema.org-typed objects on the project + embed pages,
 *   every merchant's name, offers, prices, and live status become
 *   machine-readable — without any new backend, API, or DB work.
 *
 *   This is the cheapest "make DUM AI-discoverable" move available.
 *   No consumer-visible UI change.
 *
 * What this is NOT:
 *   - Not the public REST API (separate, forthcoming).
 *   - Not exhaustive. Today we emit what we already have data for.
 *     Location, hours, phone, category land once migration 035
 *     populates those columns.
 *
 * What's emitted:
 *   - LocalBusiness: on /project/[slug]. The merchant's storefront.
 *     Includes makesOffer[] for each active offer.
 *   - Product: on /embed/[slug] for the pinned offer. Embed pages
 *     load on the merchant's own domain, where their site usually
 *     provides the LocalBusiness markup; we add product detail.
 *   - BroadcastEvent: on /project/[slug] when the merchant is live.
 *     Eligible for Google's "Live" rich-result badge.
 */

type ProjectLike = {
  id?: string;
  slug?: string | null;
  name?: string | null;
  title?: string | null;
  description?: string | null;
  is_live?: boolean | null;
};

type OfferLike = {
  id: string;
  title?: string | null;
  description?: string | null;
  price_usd?: number | null;
  quantity_available?: number | null;
  quantity_sold?: number | null;
  unlimited_inventory?: boolean | null;
};

const DEFAULT_ORIGIN = "https://dum.club";

/**
 * Map an offer's inventory state to a Schema.org availability URI.
 * Matches the same logic used in the embed UI's pinned-card "Sold out"
 * derivation, so what crawlers see equals what shoppers see.
 */
function offerAvailability(offer: OfferLike): string {
  if (offer.unlimited_inventory) return "https://schema.org/InStock";
  const total = Number(offer.quantity_available || 0);
  const sold = Number(offer.quantity_sold || 0);
  if (total > 0 && total - sold <= 0) return "https://schema.org/SoldOut";
  return "https://schema.org/InStock";
}

function projectName(project: ProjectLike): string {
  return project.name || project.title || "DUM Club Business";
}

function projectSlug(project: ProjectLike): string {
  return project.slug || project.id || "";
}

/**
 * LocalBusiness with embedded Offers, one per active offer.
 * Returns null if we don't have a usable slug to URL-address the
 * business — Schema.org @id needs to be a stable URL.
 */
export function buildLocalBusinessSchema(
  project: ProjectLike,
  offers: OfferLike[],
  origin: string = DEFAULT_ORIGIN
): object | null {
  const slug = projectSlug(project);
  if (!slug) return null;

  const name = projectName(project);
  const pageUrl = `${origin}/project/${slug}`;
  const embedBase = `${origin}/embed/${slug}`;

  const makesOffer = offers
    .filter((o) => o.title && o.price_usd != null)
    .map((o) => ({
      "@type": "Offer",
      name: o.title,
      ...(o.description ? { description: o.description } : {}),
      price: Number(o.price_usd || 0).toFixed(2),
      priceCurrency: "USD",
      availability: offerAvailability(o),
      url: `${embedBase}?offer=${o.id}`,
    }));

  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": pageUrl,
    name,
    ...(project.description ? { description: project.description } : {}),
    url: pageUrl,
    ...(makesOffer.length > 0 ? { makesOffer } : {}),
  };
}

/**
 * Product schema for a single offer. Used on the embed page's pinned
 * offer so merchant iframes contribute product-level structured data
 * to whatever host page they're embedded in.
 */
export function buildProductSchema(
  project: ProjectLike,
  offer: OfferLike,
  origin: string = DEFAULT_ORIGIN
): object | null {
  const slug = projectSlug(project);
  if (!slug || !offer.title || offer.price_usd == null) return null;

  const businessName = projectName(project);
  const embedUrl = `${origin}/embed/${slug}`;

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: offer.title,
    ...(offer.description ? { description: offer.description } : {}),
    brand: { "@type": "Brand", name: businessName },
    offers: {
      "@type": "Offer",
      url: embedUrl,
      priceCurrency: "USD",
      price: Number(offer.price_usd || 0).toFixed(2),
      availability: offerAvailability(offer),
      seller: { "@type": "Organization", name: businessName },
    },
  };
}

/**
 * BroadcastEvent for live shows. Returns null when the merchant is
 * offline so the JsonLd helper drops it cleanly. Emitting this only
 * during is_live=true is what gates Google's "Live" badge eligibility.
 */
export function buildBroadcastEventSchema(
  project: ProjectLike,
  origin: string = DEFAULT_ORIGIN
): object | null {
  if (!project.is_live) return null;
  const slug = projectSlug(project);
  if (!slug) return null;

  const businessName = projectName(project);
  const pageUrl = `${origin}/project/${slug}`;

  return {
    "@context": "https://schema.org",
    "@type": "BroadcastEvent",
    name: `${businessName} — Live now`,
    isLiveBroadcast: true,
    // Google requires startDate. We don't track stream-start time on
    // the project today, so use page-render time. Refines once the
    // public /live endpoint surfaces stream_started_at (Phase 2).
    startDate: new Date().toISOString(),
    location: {
      "@type": "VirtualLocation",
      url: pageUrl,
    },
  };
}
