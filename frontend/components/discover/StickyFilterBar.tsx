"use client";

/**
 * Sticky filter bar — sticks below header on scroll.
 *
 * Category dropdown on desktop, chips on mobile.
 * "Live now" disabled with tooltip when no live results.
 * "Deals only" hidden when no project has promo_copy.
 * "Nearest" sort hidden in Pass 1 (no geo).
 */

import { DISCOVER_CATEGORIES } from "../../lib/discover/filters";
import type { DiscoverCategoryId, DiscoverSortId, PriceFilter } from "../../lib/discover/types";

type StickyFilterBarProps = {
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  activeCategory: DiscoverCategoryId;
  setActiveCategory: (id: DiscoverCategoryId) => void;
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
    <div className="sticky top-0 z-40 -mx-4 mb-6 border-b border-zinc-800/60 bg-[#060606]/95 px-4 pb-3 pt-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={props.searchQuery}
          onChange={(e) => props.setSearchQuery(e.target.value)}
          placeholder="Search local businesses, services, live shows..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-emerald-400/50 sm:max-w-md"
        />
      </div>

      {/* Category chips (mobile) / dropdown (desktop) + filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Category — chips on mobile, dropdown on desktop.
            w-full + min-w-0 ensure overflow-x-auto actually engages on mobile.
            Without these, the chip row sized to its content and clipped past
            the viewport edge (HOME → "HO") instead of scrolling. */}
        <div className="flex w-full min-w-0 gap-1 overflow-x-auto sm:hidden sm:w-auto [&::-webkit-scrollbar]:hidden">
          {DISCOVER_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => props.setActiveCategory(cat.id)}
              className={`flex flex-shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
                props.activeCategory === cat.id
                  ? "bg-emerald-400 text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        {/* Category dropdown (desktop) */}
        <label className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500 sm:flex">
          Category
          <select
            value={props.activeCategory}
            onChange={(e) => props.setActiveCategory(e.target.value as DiscoverCategoryId)}
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/80 px-2 py-1.5 text-[11px] text-zinc-300 outline-none transition hover:border-emerald-400/40 focus:border-emerald-400/50"
          >
            {DISCOVER_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.icon} {cat.label}
              </option>
            ))}
          </select>
        </label>

        {/* Sort */}
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          Sort
          <select
            value={props.sortBy}
            onChange={(e) => props.setSortBy(e.target.value as DiscoverSortId)}
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/80 px-2 py-1.5 text-[11px] text-zinc-300 outline-none transition hover:border-emerald-400/40 focus:border-emerald-400/50"
          >
            <option value="newest">Newest</option>
            <option value="popular">Most Popular</option>
            <option value="priceAsc">Price: Low → High</option>
            <option value="priceDesc">Price: High → Low</option>
          </select>
        </label>

        {/* Price */}
        <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          Price
          <select
            value={props.priceFilter}
            onChange={(e) => props.setPriceFilter(e.target.value as PriceFilter)}
            className="rounded-lg border border-zinc-700/60 bg-zinc-900/80 px-2 py-1.5 text-[11px] text-zinc-300 outline-none transition hover:border-emerald-400/40 focus:border-emerald-400/50"
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
          title={props.hasAnyLive ? undefined : "No live shows yet — check back soon"}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
            !props.hasAnyLive
              ? "cursor-not-allowed border-zinc-800 text-zinc-700"
              : props.liveOnly
                ? "border-red-500/50 bg-red-500/15 text-red-400"
                : "border-zinc-700/60 text-zinc-400 hover:border-zinc-600 hover:text-white"
          }`}
        >
          <span className="relative flex h-1.5 w-1.5">
            {props.liveOnly && props.hasAnyLive ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
              </>
            ) : (
              <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${props.hasAnyLive ? "bg-zinc-500" : "bg-zinc-800"}`} />
            )}
          </span>
          Live now
        </button>

        {/* Deals only toggle — hidden if no project has promo_copy */}
        {props.hasAnyPromo && (
          <button
            onClick={() => props.setDealsOnly(!props.dealsOnly)}
            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
              props.dealsOnly
                ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-400"
                : "border-zinc-700/60 text-zinc-400 hover:border-zinc-600 hover:text-white"
            }`}
          >
            Deals only
          </button>
        )}

        {/* Reset */}
        {props.isFiltered && (
          <button
            onClick={props.onReset}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-zinc-500 transition hover:text-white"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
