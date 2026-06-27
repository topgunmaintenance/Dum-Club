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
  applyLocationFilter,
  availableCities,
  countWithCoords,
  type LatLng,
} from "../../lib/discover/location";
import {
  filterProjects,
  sortProjects,
  isDiscoverable,
  lowestOfferPrice,
  withoutLive,
  hasOffers,
} from "../../lib/discover/filters";
import { VERBS, isVerbId, projectMatchesVerb } from "../../lib/discover/verbs";
import type { VerbTabId } from "../../components/discover/VerbTabs";
import type {
  DiscoverCategoryId,
  DiscoverSortId,
  PriceFilter,
  ItemResult,
} from "../../lib/discover/types";
import { API_BASE } from "../../lib/apiBase";
import { resolveOfferCategoryLabel } from "../../lib/categories";
import { useAuth } from "../../lib/auth/AuthContext";

import { StickyFilterBar } from "../../components/discover/StickyFilterBar";
import { CategoryFollowButton } from "../../components/discover/CategoryFollowButton";
import { FollowedRail } from "../../components/discover/FollowedRail";
import { LiveNowRail } from "../../components/discover/LiveNowRail";
import { StartingSoon } from "../../components/discover/StartingSoon";
import { ListingGrid, LoadingGrid } from "../../components/discover/ListingGrid";
import { EmptyState } from "../../components/discover/EmptyState";
import { MerchantStrip } from "../../components/discover/MerchantStrip";

export function ClubHome() {
  /* ─── Data ─── */
  const { projects, marketByProject, loading, error, marketLoaded, hasMore, loadMore, loadingMore } = useProjects();
  const { user, getToken } = useAuth();

  /* ─── Follow: follower counts (batch) + the viewer's followed set ─── */
  const [followerCounts, setFollowerCounts] = useState<Record<string, number>>({});
  const [followingSet, setFollowingSet] = useState<Set<string>>(() => new Set());

  /* ─── Filter state ─── */
  // Category pills: "For you" (all) leads, then the verbs (EAT/FIX/MOVE/SHOP/
  // BOOK). "For you" is the default so the home opens populated. activeCategory
  // stays as a secondary, URL-only filter (defaults to "all" / no-op).
  const [activeVerb, setActiveVerb] = useState<VerbTabId>("all");
  const [activeCategory, setActiveCategory] = useState<DiscoverCategoryId>("all");
  const [sortBy, setSortBy] = useState<DiscoverSortId>("newest");
  const [liveOnly, setLiveOnly] = useState(false);
  const [dealsOnly, setDealsOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("any");
  const [searchQuery, setSearchQuery] = useState("");

  /* ─── Location filter state ("Near me" + city) ─── */
  const NEAR_ME_RADIUS_MILES = 50;
  const [nearMe, setNearMe] = useState(false);
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [cityFilter, setCityFilter] = useState("");
  const [geoError, setGeoError] = useState<string | null>(null);

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
    const verb = params.get("verb");
    if (verb === "all" || isVerbId(verb)) setActiveVerb(verb as VerbTabId);
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
            image: (typeof o.primary_image_url === "string" && o.primary_image_url.trim()) || null,
            // Per-offer category badge dual-pathway support.
            categoryId: o.category_id ?? null,
            parentProject: {
              name: o.project_name,
              description: o.project_description,
              template_type: o.project_template_type,
              category_id: o.project_category_id,
            },
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

  /* ─── Verb filter (EAT/FIX/MOVE/SHOP/BOOK) — the primary category cut ─── */
  const verbProjects = useMemo(
    () =>
      activeVerb === "all"
        ? filteredProjects
        : filteredProjects.filter((p) => projectMatchesVerb(p, activeVerb)),
    [filteredProjects, activeVerb],
  );
  const activeVerbLabel = VERBS.find((v) => v.id === activeVerb)?.label ?? "";

  /* ─── Location filter (city + "near me"), applied on top of the rest ───
     Reads optional city/lat/lng off each project; degrades to a no-op when
     that data is absent (today: storefronts have no coordinates yet). */
  const cities = useMemo(() => availableCities(projects as Array<Record<string, unknown>>), [projects]);
  const noCoordsAnywhere = useMemo(
    () => nearMe && countWithCoords(verbProjects as Array<Record<string, unknown>>) === 0,
    [nearMe, verbProjects],
  );
  const locatedProjects = useMemo(
    () =>
      applyLocationFilter(verbProjects, {
        city: cityFilter || null,
        near: nearMe && coords ? { center: coords, radiusMiles: NEAR_ME_RADIUS_MILES } : null,
      }),
    [verbProjects, cityFilter, nearMe, coords],
  );

  const toggleNearMe = useCallback(() => {
    if (nearMe) {
      setNearMe(false);
      setGeoError(null);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Location isn't available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNearMe(true);
        setGeoError(null);
      },
      () => {
        setGeoError("We couldn't get your location. Check your browser permission and try again.");
        setNearMe(false);
      },
      { timeout: 8000 },
    );
  }, [nearMe]);

  const liveResults = useMemo(() => locatedProjects.filter((p) => p.is_live === true), [locatedProjects]);
  // Shared one-presence rule with the homepage (withoutLive): live
  // sellers render only in the LiveRail above; the grid's "Live Now"
  // section below renders solely when the live-only filter is active
  // (the rail's "+N more live" overflow target).
  // Lead with populated shops: a current deal first, then shops with offers,
  // then the rest — so the grid never opens on bare/quiet listings.
  const businessResults = useMemo(() => {
    const rank = (p: typeof locatedProjects[number]) =>
      (p.promo_copy ? 2 : 0) + (hasOffers(p) ? 1 : 0);
    return [...withoutLive(locatedProjects)].sort((a, b) => rank(b) - rank(a));
  }, [locatedProjects]);

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

  /* Follower counts for every visible shop, one batched request. */
  useEffect(() => {
    const ids = discoverable.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) { setFollowerCounts({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/favorites/counts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_ids: ids }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.counts) setFollowerCounts(data.counts);
      } catch { /* best-effort: cards just show no count */ }
    })();
    return () => { cancelled = true; };
  }, [discoverable]);

  /* The signed-in viewer's followed shops (so cards render Following state). */
  useEffect(() => {
    if (!user) { setFollowingSet(new Set()); return; }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/favorites/mine`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.favorites)) {
          setFollowingSet(new Set(data.favorites.map((f: { project_id: string }) => f.project_id)));
        }
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [user, getToken]);
  // The viewer's followed shops, drawn from the same feed (no extra fetch).
  // Powers the "From shops you follow" strip atop the feed; empty for
  // signed-out visitors, so the rail self-hides.
  const followedProjects = useMemo(
    () => (followingSet.size ? discoverable.filter((p) => followingSet.has(p.id)) : []),
    [discoverable, followingSet],
  );
  const hasAnyLive = useMemo(() => discoverable.some((p) => p.is_live === true), [discoverable]);
  const hasAnyPromo = useMemo(() => discoverable.some((p) => !!p.promo_copy), [discoverable]);
  const isFiltered =
    activeCategory !== "all" || sortBy !== "newest" || priceFilter !== "any" || liveOnly || dealsOnly || searchQuery.trim() !== "" || nearMe || cityFilter !== "";

  const resetFilters = useCallback(() => {
    setActiveCategory("all");
    setSortBy("newest");
    setPriceFilter("any");
    setLiveOnly(false);
    setDealsOnly(false);
    setSearchQuery("");
    setNearMe(false);
    setCityFilter("");
    setGeoError(null);
  }, []);

  /* ─── Render ─── */
  return (
    <main className="relative min-h-screen bg-surface-page text-primary">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* The Club home leads straight with the category pills (mock-style) —
            no marketing hero / trust strip here. The pitch lives at /welcome. */}

        {/* Sticky filter bar */}
        <StickyFilterBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          activeVerb={activeVerb}
          setActiveVerb={setActiveVerb}
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

        {/* Follow-a-category — "get pinged when a <verb> shop goes live".
            Shown only when a real verb is selected (not "For you"). */}
        {activeVerb !== "all" && activeVerbLabel && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm text-secondary">
              Get pinged when a {activeVerbLabel} shop goes live.
            </span>
            <CategoryFollowButton category={activeVerb} label={activeVerbLabel} />
          </div>
        )}

        {/* Compact location control (our local-biz edge) — a single Near-me
            pill + optional city select, no big card, so the home stays
            pills-clean like the mock. */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleNearMe}
            aria-pressed={nearMe}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition ${
              nearMe
                ? "border-mint-text bg-transparent text-mint-text"
                : "border-default bg-surface-card text-secondary hover:border-strong hover:text-primary"
            }`}
          >
            <span aria-hidden="true">📍</span>
            {nearMe ? `Near me · ${NEAR_ME_RADIUS_MILES} mi` : "Near me"}
          </button>

          {cities.length > 0 && (
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              aria-label="Filter by city"
              className="rounded-full border border-default bg-surface-card px-3 py-1.5 text-xs font-semibold text-secondary"
            >
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}

          {geoError && <span className="text-xs text-state-live">{geoError}</span>}
          {noCoordsAnywhere && <span className="text-[11px] text-muted">Showing everywhere</span>}
        </div>

        {/* Live now — the signature rail: shops broadcasting right now lead the
            feed (Option B). Self-hides when nothing is live. */}
        <LiveNowRail projects={discoverable} />

        {/* From shops you follow — personalised strip, signed-in viewers with
            at least one follow only (self-hides otherwise). */}
        <FollowedRail projects={followedProjects} />

        {/* Starting soon — scheduled shows (real scheduled_live_at) as a list
            with inline Remind buttons. Renders only when something's booked. */}
        <StartingSoon projects={discoverable} />

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
              {/* Empty grid — distinguish a verb with no merchants yet from a
                  location filter that removed everything, so the message and
                  the action actually help. */}
              {verbProjects.length === 0 ? (
                <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
                  <p className="text-sm font-semibold text-primary">
                    No {activeVerbLabel} shops here yet.
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
                    Try another tab above to see what local sellers are up to.
                  </p>
                </div>
              ) : locatedProjects.length === 0 ? (
                <div className="rounded-2xl border border-default bg-surface-card p-6 text-center">
                  <p className="text-sm text-secondary">
                    No storefronts match your location filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setNearMe(false);
                      setCityFilter("");
                      setGeoError(null);
                    }}
                    className="mt-3 inline-flex items-center rounded-xl border border-default bg-surface-muted px-4 py-2 text-sm font-semibold text-primary transition hover:border-strong"
                  >
                    Clear location filter
                  </button>
                </div>
              ) : null}

              {/* Live section — rendered ONLY when the live-only
                  filter is active (the LiveRail overflow's
                  /discover?live=1 target). Otherwise the rail above
                  is a live seller's single presence on this page. */}
              {liveOnly && liveResults.length > 0 && (
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
                    followerCounts={followerCounts}
                    followingSet={followingSet}
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
                    followerCounts={followerCounts}
                    followingSet={followingSet}
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
                        {/* Per-offer thumbnail. Optional — backwards-compat:
                            an offer with no primary_image_url still renders
                            the existing text-only tile layout exactly as
                            before this PR. */}
                        {item.image && (
                          <div className="-mx-5 -mt-5 mb-4 overflow-hidden rounded-t-xl border-b border-default bg-surface-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.image}
                              alt={item.title}
                              loading="lazy"
                              className="block h-32 w-full object-cover"
                            />
                          </div>
                        )}
                        {/* Eyebrow row — project name + per-offer category
                            pill. Pill resolves through offers.category_id →
                            project.category_id → classifier; never empty,
                            never "undefined" (see resolveOfferCategoryLabel).
                            All offers are NULL category_id today, so the
                            label cascades to the parent project's resolved
                            label (Topgun → "Aviation" via classifier).  */}
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-secondary">
                            {item.projectName}
                          </span>
                          <span className="shrink-0 rounded-full border border-default bg-surface-muted px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-secondary">
                            {resolveOfferCategoryLabel({ category_id: item.categoryId, project: item.parentProject })}
                          </span>
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
