"use client";

/**
 * /discover — buyer-facing local + live commerce page (Pass 1).
 *
 * Rebuilt from the original 1517-line monolith into composable
 * components. Uses existing endpoints only:
 *   GET /api/projects/public
 *   GET /api/projects/{id}/market (batched in chunks of 8)
 *   GET /api/offers/search?q=<term>&limit=20
 *
 * Doctrine constraints respected:
 * - No PointsWallet, no points balance (§12 Rule 4)
 * - No fake data (§12 Rule 2)
 * - No new API routes (Phase 0B)
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";

import { useProjects } from "../../lib/discover/useProjects";
import {
  filterProjects,
  sortProjects,
  isDiscoverable,
  lowestOfferPrice,
} from "../../lib/discover/filters";
import type {
  DiscoverCategoryId,
  DiscoverSortId,
  PriceFilter,
  ItemResult,
} from "../../lib/discover/types";
import { API_BASE } from "../../lib/apiBase";

import { DiscoverHero } from "../../components/discover/DiscoverHero";
import { TrustStrip } from "../../components/discover/TrustStrip";
import { StickyFilterBar } from "../../components/discover/StickyFilterBar";
import { LiveRail } from "../../components/discover/LiveRail";
import { ListingGrid, LoadingGrid } from "../../components/discover/ListingGrid";
import { EmptyState } from "../../components/discover/EmptyState";
import { MerchantStrip } from "../../components/discover/MerchantStrip";

export default function DiscoverPage() {
  /* ─── Data ─── */
  const { projects, marketByProject, loading, error, marketLoaded, hasMore, loadMore, loadingMore } = useProjects();

  /* ─── Filter state ─── */
  const [activeCategory, setActiveCategory] = useState<DiscoverCategoryId>("all");
  const [sortBy, setSortBy] = useState<DiscoverSortId>("newest");
  const [liveOnly, setLiveOnly] = useState(false);
  const [dealsOnly, setDealsOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("any");
  const [searchQuery, setSearchQuery] = useState("");

  /* ─── Pulse animation ─── */
  const [pulseId, setPulseId] = useState<string | null>(null);
  const pulseClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─── Offer search (debounced) ─── */
  const [offerSearchResults, setOfferSearchResults] = useState<ItemResult[]>([]);

  /* ─── URL params on mount ─── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const cat = params.get("category") as DiscoverCategoryId | null;
    const sort = params.get("sort");
    const price = params.get("price");
    if (q) setSearchQuery(q);
    if (cat) setActiveCategory(cat);
    if (params.get("live") === "1") setLiveOnly(true);
    if (params.get("deals") === "1") setDealsOnly(true);
    // Validate against the enum unions before assigning — silently
    // ignore unknown values so a stale or hand-crafted URL can't
    // break sorting or price filtering.
    const VALID_SORTS: readonly DiscoverSortId[] = ["newest", "popular", "priceAsc", "priceDesc"];
    const VALID_PRICES: readonly PriceFilter[] = ["any", "under25", "under50", "under100", "over100"];
    if (sort && (VALID_SORTS as readonly string[]).includes(sort)) setSortBy(sort as DiscoverSortId);
    if (price && (VALID_PRICES as readonly string[]).includes(price)) setPriceFilter(price as PriceFilter);
  }, []);

  /* ─── Offer search debounce (300ms) ─── */
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setOfferSearchResults([]); return; }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/offers/search?q=${encodeURIComponent(q)}&limit=20`,
          { signal: controller.signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        const items: ItemResult[] = (Array.isArray(data?.offers) ? data.offers : Array.isArray(data) ? data : []).map(
          (o: any) => ({
            id: o.id,
            projectId: o.project_id,
            projectSlug: o.project_slug,
            projectName: o.project_name || "Unknown",
            title: o.title || "Untitled offer",
            description: o.description,
            price: o.price_usd != null ? Number(o.price_usd) : null,
          }),
        );
        setOfferSearchResults(items);
      } catch {
        // Aborted or failed — ignore
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  /* ─── Pulse animation (6s interval) ─── */
  useEffect(() => {
    if (!projects.length) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const liveWithPrice = projects.filter(
        (p) => (p.status || "live") === "live" && (marketByProject[p.id]?.price ?? 0) > 0,
      );
      if (!liveWithPrice.length) return;
      const byVol = [...liveWithPrice].sort(
        (a, b) => (marketByProject[b.id]?.volume_24h || 0) - (marketByProject[a.id]?.volume_24h || 0),
      );
      const top3 = byVol.slice(0, 3);
      const pick =
        top3.length && Math.random() < 0.7
          ? top3[Math.floor(Math.random() * top3.length)]
          : liveWithPrice[Math.floor(Math.random() * liveWithPrice.length)];
      setPulseId(pick.id);
      if (pulseClearRef.current) clearTimeout(pulseClearRef.current);
      pulseClearRef.current = setTimeout(() => setPulseId(null), 600);
    }, 6000);
    return () => {
      clearInterval(interval);
      if (pulseClearRef.current) clearTimeout(pulseClearRef.current);
    };
  }, [projects, marketByProject]);

  /* ─── Filtered + sorted projects ─── */
  const filteredProjects = useMemo(() => {
    const filtered = filterProjects(projects, {
      category: activeCategory,
      liveOnly,
      dealsOnly,
      priceFilter,
      searchQuery,
    });
    return sortProjects(filtered, sortBy, marketByProject);
  }, [projects, activeCategory, sortBy, liveOnly, dealsOnly, priceFilter, searchQuery, marketByProject]);

  const liveResults = useMemo(() => filteredProjects.filter((p) => p.is_live === true), [filteredProjects]);
  const businessResults = useMemo(() => filteredProjects.filter((p) => p.is_live !== true), [filteredProjects]);

  /* ─── Filter item results by price ─── */
  const filteredItems = useMemo(() => {
    if (priceFilter === "any") return offerSearchResults;
    return offerSearchResults.filter((item) => {
      if (item.price == null) return false;
      if (priceFilter === "under25") return item.price < 25;
      if (priceFilter === "under50") return item.price < 50;
      if (priceFilter === "under100") return item.price < 100;
      if (priceFilter === "over100") return item.price >= 100;
      return true;
    });
  }, [offerSearchResults, priceFilter]);

  /* ─── Derived flags ─── */
  const discoverable = useMemo(() => projects.filter(isDiscoverable), [projects]);
  const hasAnyLive = useMemo(() => discoverable.some((p) => p.is_live === true), [discoverable]);
  const hasAnyPromo = useMemo(() => discoverable.some((p) => !!p.promo_copy), [discoverable]);
  const isFiltered =
    activeCategory !== "all" || sortBy !== "newest" || priceFilter !== "any" || liveOnly || dealsOnly || searchQuery.trim() !== "";

  const resetFilters = useCallback(() => {
    setActiveCategory("all");
    setSortBy("newest");
    setPriceFilter("any");
    setLiveOnly(false);
    setDealsOnly(false);
    setSearchQuery("");
  }, []);

  /* ─── Render ─── */
  return (
    <main className="relative min-h-screen bg-surface-page text-primary">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {/* Hero — hidden for authenticated users (placeholder: always show in Pass 1) */}
        <DiscoverHero />

        {/* Trust strip */}
        <TrustStrip />

        {/* Sticky filter bar */}
        <StickyFilterBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          sortBy={sortBy}
          setSortBy={setSortBy}
          liveOnly={liveOnly}
          setLiveOnly={setLiveOnly}
          dealsOnly={dealsOnly}
          setDealsOnly={setDealsOnly}
          priceFilter={priceFilter}
          setPriceFilter={setPriceFilter}
          hasAnyLive={hasAnyLive}
          hasAnyPromo={hasAnyPromo}
          isFiltered={isFiltered}
          onReset={resetFilters}
        />

        {/* Live Rail */}
        <LiveRail projects={discoverable} />

        {/* Main grid */}
        <div id="grid">
          {loading ? (
            <>
              <p className="mb-4 text-sm text-secondary">Loading nearby businesses…</p>
              <LoadingGrid count={projects.length || 6} />
            </>
          ) : error ? (
            <EmptyState
              variant="error"
              errorMessage={error}
              onRetry={() => window.location.reload()}
            />
          ) : projects.length === 0 ? (
            // Genuine zero-data: no merchants live yet. Show the
            // founding-100 onboarding state, not a "no matches" message.
            <EmptyState variant="no-listings" />
          ) : filteredProjects.length === 0 ? (
            liveOnly ? (
              <EmptyState variant="no-live" onClearLive={() => setLiveOnly(false)} />
            ) : (
              <EmptyState variant="no-results" onClearFilters={resetFilters} />
            )
          ) : (
            <>
              {/* Live section */}
              {liveResults.length > 0 && (
                <section className="mb-8">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">
                      Live Now · {liveResults.length}
                    </h2>
                  </div>
                  <ListingGrid
                    projects={liveResults}
                    marketByProject={marketByProject}
                    pulseId={pulseId}
                  />
                </section>
              )}

              {/* Business grid */}
              {businessResults.length > 0 && (
                <section>
                  <div className="mb-3">
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">
                      Services & Businesses · {businessResults.length}
                    </h2>
                  </div>
                  <ListingGrid
                    projects={businessResults}
                    marketByProject={marketByProject}
                    pulseId={pulseId}
                  />
                </section>
              )}

              {/* Items for Sale (offer search results) */}
              {filteredItems.length > 0 && (
                <section className="mt-10">
                  <div className="mb-3">
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">
                      Items for Sale · {filteredItems.length}
                    </h2>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredItems.map((item, idx) => (
                      <Link
                        key={item.id || `${item.projectId}-${idx}`}
                        href={`/project/${item.projectSlug || item.projectId}#offers-section`}
                        className="group flex flex-col rounded-xl border border-default bg-surface-card p-5 shadow-sm transition hover:border-strong hover:shadow-md"
                      >
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-secondary">
                          {item.projectName}
                        </div>
                        <div className="text-sm font-bold text-primary transition group-hover:text-brand-teal">
                          {item.title}
                        </div>
                        {item.description && (
                          <p className="mt-1 line-clamp-2 text-[11px] text-secondary">{item.description}</p>
                        )}
                        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                          {item.price != null ? (
                            <span className="font-mono text-lg font-extrabold text-brand-navy">
                              ${item.price < 1 ? item.price.toFixed(2) : Math.round(item.price)}
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-secondary">
                              Ask for a price
                            </span>
                          )}
                          <span className="rounded-lg bg-brand-teal-soft px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-navy transition group-hover:bg-brand-teal group-hover:text-white">
                            Buy Now →
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Load more — appears only when the feed has another page. Simple
            button (no infinite-scroll observer); bumps the request limit. */}
        {!loading && !error && hasMore && (
          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center justify-center rounded-xl border border-default bg-surface-card px-6 py-3 text-sm font-bold text-primary transition hover:border-strong hover:text-brand-teal disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}

        {/* DUM Points caption — earn-only framing per CLAUDE.md §5.
            Redemption surfaces are held until Phase 2; the previous
            "more ways to earn and redeem are coming" line was
            advertising a held-pending feature. */}
        <p className="mt-10 text-center text-[11px] text-secondary">
          Earn DUM Points on every purchase. Loyalty rewards across the network.
        </p>

        {/* Merchant recruitment strip */}
        <MerchantStrip />
      </div>
    </main>
  );
}
