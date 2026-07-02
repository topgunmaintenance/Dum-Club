/**
 * Discover page types — Pass 1.
 *
 * All types derived from existing API responses.
 * No synthetic fields (ratings, sold counts, distances).
 */

import type { CategoryId } from "../categories";

/* ─── API response shapes (existing) ─── */

export type Project = {
  id: string;
  slug?: string | null;
  name?: string;
  title?: string;
  description?: string | null;
  template_type?: string;
  status?: string;
  created_at?: string;
  token_symbol?: string | null;
  token_utility?: string | null;
  promo_copy?: string | null;
  store_items?: any[] | null;
  // Count of offers in the modern `offers` table for this project,
  // enriched by /api/projects/public after the 3-pass union. Lets the
  // frontend isDiscoverable gate honor merchants whose offers live in
  // the modern table (PR #354 path) without falling back to the legacy
  // store_items JSONB. Optional: absent on older API responses.
  active_offer_count?: number | null;
  owner_verified?: boolean;
  verified?: boolean;
  is_verified?: boolean;
  profile_strength?: number | null;
  sort_order?: number | null;
  is_live?: boolean;
  // UTC timestamp set when a broadcast starts (migration 084). Powers the
  // LiveRail most-recently-live-first ordering. NULL/absent on streams that
  // went live before the column existed — those sort last (feed-order kept).
  live_started_at?: string | null;
  live_playback_id?: string | null;
  live_provider?: string | null;
  // Scheduled go-live (migration 064), UTC ISO 8601. Powers the Discover
  // "Upcoming Live" rail countdown. NULL/absent = no scheduled show; rides the
  // existing SELECT * feed, no backend change.
  scheduled_live_at?: string | null;
  // Canonical category from the seeded `categories` table
  // (migration 035). NULL on every pre-mig project; the discover
  // and storefront UIs fall back to keyword classification when
  // absent, so backwards-compat is preserved.
  category_id?: string | null;
  // Server-computed card image: cheapest active offer with a photo
  // (offers table, /api/projects/public enrichment). NULL when the
  // merchant has no offer photos — the card cascade then tries the
  // cover/logo below.
  featured_offer_image?: string | null;
  // Embedded merchant logo/cover (joined via projects.business_profile_id
  // by /api/projects/public). Optional on both axes — a merchant that
  // hasn't supplied an image still renders the existing emoji avatar.
  business_profile?: {
    logo_url?: string | null;
    cover_image_url?: string | null;
    // Storefront location (migration 079), now selected onto the feed so the
    // Discover "Near me" + city filter can read it. NULL until a merchant has
    // shared a location — the filter degrades gracefully (lib/discover/location).
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

export type MarketSnapshot = {
  price: number;
  market_cap: number;
  volume_24h: number;
};

/* ─── Filter / sort state ─── */

export type DiscoverCategoryId = "all" | CategoryId;

export type DiscoverCategoryDef = {
  readonly id: DiscoverCategoryId;
  readonly label: string;
  readonly icon: string;
};

export type DiscoverSortId =
  | "newest"
  | "popular"
  | "priceAsc"
  | "priceDesc";

export type PriceFilter = "any" | "under25" | "under50" | "under100" | "over100";

/* ─── Offer search result (from /api/offers/search) ─── */

export type ItemResult = {
  id?: string;
  projectId: string;
  projectSlug?: string | null;
  projectName: string;
  title: string;
  description?: string;
  price: number | null;
  // Per-offer thumbnail. Already returned by /api/offers/search
  // (offers.primary_image_url, migration 011). Optional — falls
  // back to a text-only tile when absent.
  image?: string | null;
  // Per-offer category badge dual-pathway resolution (mig 035 /
  // resolveOfferCategoryLabel). Both NULL today on every offer;
  // fallback handles all NULL paths so the pill is always populated.
  categoryId?: string | null;
  // Slim parent-project view used by the classifier fallback when
  // both offer.category_id and project.category_id are NULL. Mirrors
  // the fields /api/offers/search includes for that exact purpose.
  parentProject?: {
    name?: string;
    description?: string;
    template_type?: string;
    category_id?: string | null;
  } | null;
};

/* ─── View model for ListingCard ─── */

export type ListingCardVM = {
  id: string;
  href: string;
  title: string;
  category: string | null;
  description: string;
  ownerName: string;
  priceFrom: number | null;
  offersCount: number;
  isLive: boolean;
  hasPromo: boolean;
  hasSubscription: boolean;
  createdAt: string;
  sortOrder: number | null;
};
