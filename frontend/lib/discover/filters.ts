/**
 * Discover page filter/sort helpers — Pass 1.
 *
 * Pure functions extracted from the original 1517-line discover page.
 * No projectReadinessScore — Pass 1 doesn't render profile strength.
 */

import { CATEGORIES, classifyProject, type CategoryId } from "../categories";
import type {
  Project,
  MarketSnapshot,
  DiscoverCategoryId,
  DiscoverCategoryDef,
  DiscoverSortId,
  PriceFilter,
} from "./types";

/* ─── Category definitions for the filter bar ─── */

export const DISCOVER_CATEGORIES: readonly DiscoverCategoryDef[] = [
  { id: "all", label: "All", icon: "◎" },
  ...CATEGORIES.map((c) => ({ id: c.key as DiscoverCategoryId, label: c.label, icon: c.icon })),
];

/* ─── Project field helpers ─── */

export function hasOffers(project: Project): boolean {
  return Array.isArray(project.store_items) && project.store_items.length > 0;
}

export function hasSubscription(project: Project): boolean {
  return (
    Array.isArray(project.store_items) &&
    project.store_items.some((i: any) => i.type === "subscription")
  );
}

export function offerCount(project: Project): number {
  return Array.isArray(project.store_items) ? project.store_items.length : 0;
}

export function lowestOfferPrice(project: Project): number | null {
  if (!Array.isArray(project.store_items) || project.store_items.length === 0) return null;
  const prices = project.store_items
    .map((i: any) => Number(i.price_usd ?? i.price ?? 0))
    .filter((p) => p > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export function getProjectEmoji(project: Project, index: number): string {
  const source = `${project.title || project.name || ""} ${project.template_type || ""}`.toLowerCase();
  if (source.includes("fitness") || source.includes("health")) return "💪";
  if (source.includes("math") || source.includes("tutor")) return "🧠";
  if (source.includes("movie") || source.includes("script")) return "🎬";
  if (source.includes("music") || source.includes("beat")) return "🎵";
  if (source.includes("crypto") || source.includes("signal")) return "📈";
  if (source.includes("clean")) return "🧹";
  return ["🚀", "⚡", "🧠", "💡", "📦", "🌐"][index % 6];
}

export function getAccent(index: number): string {
  const accents = ["#00FFB2", "#FF6B35", "#A78BFA", "#FBBF24", "#38BDF8", "#F472B6"];
  return accents[index % accents.length];
}

export function getProjectLabel(project?: Project): string {
  return project?.title || project?.name || "—";
}

export function categoryIncludesProject(project: Project, category: DiscoverCategoryId): boolean {
  if (category === "all") return true;
  return classifyProject(project) === category;
}

/* ─── Visibility filter (Pass 1 — client-side) ─── */

/**
 * A project is visible on /discover iff it has at least one offer,
 * a non-placeholder description, and isn't auto-generated junk.
 */
export function isDiscoverable(project: Project): boolean {
  if (!hasOffers(project)) return false;
  const desc = (project.description || "").trim();
  if (desc.length < 20) return false;
  const title = (project.title || project.name || "").trim().toLowerCase();
  if (title.startsWith("auto-created")) return false;
  if (title.startsWith("no description")) return false;
  return true;
}

/* ─── Sort ─── */

export function sortProjects(
  list: Project[],
  sortBy: DiscoverSortId,
  marketByProject: Record<string, MarketSnapshot>,
): Project[] {
  let sorted = [...list];

  // Primary sort
  if (sortBy === "newest") {
    sorted.sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
    );
  } else if (sortBy === "popular") {
    // Without readiness score, fall back to volume_24h + verified boost
    sorted.sort((a, b) => {
      const scoreA = (marketByProject[a.id]?.volume_24h || 0) + (a.owner_verified ? 1000 : 0);
      const scoreB = (marketByProject[b.id]?.volume_24h || 0) + (b.owner_verified ? 1000 : 0);
      return scoreB - scoreA;
    });
  } else if (sortBy === "priceAsc") {
    sorted.sort((a, b) => {
      const la = lowestOfferPrice(a);
      const lb = lowestOfferPrice(b);
      if (la == null && lb == null) return 0;
      if (la == null) return 1;
      if (lb == null) return -1;
      return la - lb;
    });
  } else if (sortBy === "priceDesc") {
    sorted.sort((a, b) => {
      const la = lowestOfferPrice(a);
      const lb = lowestOfferPrice(b);
      if (la == null && lb == null) return 0;
      if (la == null) return 1;
      if (lb == null) return -1;
      return lb - la;
    });
  }

  // Live projects float to top
  sorted.sort((a, b) => (b.is_live ? 1 : 0) - (a.is_live ? 1 : 0));

  // Pinned projects (sort_order non-null) float above everything
  sorted.sort((a, b) => {
    const aPinned = a.sort_order != null;
    const bPinned = b.sort_order != null;
    if (aPinned && bPinned) return (a.sort_order as number) - (b.sort_order as number);
    if (aPinned) return -1;
    if (bPinned) return 1;
    return 0;
  });

  return sorted;
}

/* ─── Full filter pipeline ─── */

export function filterProjects(
  projects: Project[],
  opts: {
    category: DiscoverCategoryId;
    liveOnly: boolean;
    dealsOnly: boolean;
    priceFilter: PriceFilter;
    searchQuery: string;
  },
): Project[] {
  let list = projects;

  // Visibility gate
  list = list.filter(isDiscoverable);

  // Category
  list = list.filter((p) => categoryIncludesProject(p, opts.category));

  // Live
  if (opts.liveOnly) list = list.filter((p) => p.is_live === true);

  // Deals (promo_copy presence)
  if (opts.dealsOnly) list = list.filter((p) => !!p.promo_copy);

  // Price
  if (opts.priceFilter !== "any") {
    list = list.filter((p) => {
      const low = lowestOfferPrice(p);
      if (low == null) return false;
      if (opts.priceFilter === "under25") return low < 25;
      if (opts.priceFilter === "under50") return low < 50;
      if (opts.priceFilter === "under100") return low < 100;
      if (opts.priceFilter === "over100") return low >= 100;
      return true;
    });
  }

  // Search
  if (opts.searchQuery.trim()) {
    const q = opts.searchQuery.toLowerCase();
    list = list.filter(
      (p) =>
        (p.title || p.name || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) ||
        (p.token_utility || "").toLowerCase().includes(q),
    );
  }

  return list;
}
