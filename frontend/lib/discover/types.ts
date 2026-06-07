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
  owner_verified?: boolean;
  verified?: boolean;
  is_verified?: boolean;
  profile_strength?: number | null;
  sort_order?: number | null;
  is_live?: boolean;
  live_playback_id?: string | null;
  live_provider?: string | null;
  // Canonical category from the seeded `categories` table
  // (migration 035). NULL on every pre-mig project; the discover
  // and storefront UIs fall back to keyword classification when
  // absent, so backwards-compat is preserved.
  category_id?: string | null;
  // Embedded merchant logo/cover (joined via projects.business_profile_id
  // by /api/projects/public). Optional on both axes — a merchant that
  // hasn't supplied an image still renders the existing emoji avatar.
  business_profile?: {
    logo_url?: string | null;
    cover_image_url?: string | null;
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
