"use client";

/**
 * Sticky filter bar. sticks below header on scroll.
 *
 * Category dropdown on desktop, chips on mobile.
 * "Live now" disabled with tooltip when no live results.
 * "Deals only" hidden when no project has promo_copy.
 * "Nearest" sort hidden in Pass 1 (no geo).
 */

import type { DiscoverSortId, PriceFilter } from "../../lib/discover/types";
import type { VerbId } from "../../lib/discover/verbs";
import { VerbTabs } from "./VerbTabs";

type StickyFilterBarProps = {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  activeVerb: VerbId;
  setActiveVerb: (id: VerbId) => void;
  sortBy: DiscoverSortId;
  setSortBy: (id: DiscoverSortId) => void;
  liveOnly: boolean;
  setLiveOnly: (v: boolean) => void;
  dealsOnly: boolean;
  setDealsOnly: (v: boolean) => void;
  priceFilter: PriceFilter;
  setPriceFilter: (v: PriceFilter) => void;
  hasAnyLive: boolean;
  hasAnyPromo: boolean;
  isFiltered: boolean;
  onReset: () => void;
};

export function StickyFilterBar(props: StickyFilterBarProps) {
  return (
    <div className="sticky top-16 z-30 -mx-4 mb-6 border-b border-default bg-surface-card/95 px-4 pb-3 pt-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-20">
      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
          placeholder="Search local businesses, services, live shows..."
          className="w-full rounded-lg border border-default bg-surface-card px-4 py-2.5 text-sm text-primary placeholder:text-muted outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/30 sm:max-w-md"
        />
      </div>

      {/* Verb tabs — EAT / FIX / MOVE / SHOP / BOOK. The primary category
          control: plain-English verbs over the existing category system. */}
      <VerbTabs active={props.activeVerb} onSelect={props.setActiveVerb} />

      {/* Filters row: sort, price, live, deals, reset */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Sort */}
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-secondary">
          Sort
          <select
            value={props.sortBy}
            onChange={(e) => props.setSortBy(e.target.value as DiscoverSortId)}
            className="rounded-lg border border-default bg-surface-card px-2 py-1.5 text-[11px] text-primary outline-none transition hover:border-strong focus:border-brand-teal"
          >
            <option value="newest">Newest</option>
            <option value="popular">Most Popular</option>
            <option value="priceAsc">Price: Low → High</option>
            <option value="priceDesc">Price: High → Low</option>
          </select>
        </label>

        {/* Price */}
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-secondary">
          Price
          <select
            value={props.priceFilter}
            onChange={(e) => props.setPriceFilter(e.target.value as PriceFilter)}
            className="rounded-lg border border-default bg-surface-card px-2 py-1.5 text-[11px] text-primary outline-none transition hover:border-strong focus:border-brand-teal"
          >
            <option value="any">Any</option>
            <option value="under25">Under $25</option>
            <option value="under50">Under $50</option>
            <option value="under100">Under $100</option>
            <option value="over100">$100+</option>
          </select>
        </label>

        {/* Live now toggle */}
        <button
          onClick={() => props.hasAnyLive && props.setLiveOnly(!props.liveOnly)}
          disabled={!props.hasAnyLive}
          title={props.hasAnyLive ? undefined : "No live shows yet. check back soon"}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
            !props.hasAnyLive
              ? "cursor-not-allowed border-default text-muted"
              : props.liveOnly
                ? "border-[var(--state-live)]/40 bg-[var(--state-live)]/10 text-state-live"
                : "border-[var(--state-live)]/30 text-state-live hover:border-[var(--state-live)]/50"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {/* Pulse red whenever live content exists (real hasAnyLive), not
                only when the filter is active — so the live signal draws the
                eye and invites the click, Whatnot-style. Greys out only when
                nothing is actually live (never a fabricated pulse). */}
            {props.hasAnyLive ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-state-live opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-state-live" />
              </>
            ) : (
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-muted" />
            )}
          </span>
          Live now
        </button>

        {/* Deals only toggle. hidden if no project has promo_copy */}
        {props.hasAnyPromo && (
          <button
            onClick={() => props.setDealsOnly(!props.dealsOnly)}
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
              props.dealsOnly
                ? "border-brand-teal bg-brand-teal-soft text-brand-navy"
                : "border-default text-secondary hover:border-strong hover:text-primary"
            }`}
          >
            Deals only
          </button>
        )}

        {/* Reset */}
        {props.isFiltered && (
          <button
            onClick={props.onReset}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-secondary transition hover:text-primary"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
