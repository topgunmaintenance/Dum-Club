"use client";

/**
 * CategoryTabs — horizontal, scrollable category tabs for /discover.
 *
 * Whatnot-style: one scrollable tab strip on all viewports with an underline
 * indicator on the active tab, replacing the old mobile chip row + desktop
 * dropdown. Same DISCOVER_CATEGORIES source and same setActiveCategory state —
 * a presentation swap only, no change to filter logic.
 */

import { DISCOVER_CATEGORIES } from "../../lib/discover/filters";
import type { DiscoverCategoryId } from "../../lib/discover/types";

export function CategoryTabs({
  active,
  onSelect,
}: {
  active: DiscoverCategoryId;
  onSelect: (id: DiscoverCategoryId) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
      <div className="flex w-max items-center gap-1 border-b border-default">
        {DISCOVER_CATEGORIES.map((cat) => {
          const isActive = active === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.id)}
              aria-pressed={isActive}
              className={`relative flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-xs font-bold uppercase tracking-[0.08em] transition ${
                isActive ? "text-brand-navy" : "text-secondary hover:text-primary"
              }`}
            >
              <span aria-hidden="true">{cat.icon}</span>
              <span>{cat.label}</span>
              {/* Active underline — the Whatnot tab indicator. */}
              {isActive && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-teal" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
