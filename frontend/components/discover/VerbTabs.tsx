"use client";

/**
 * VerbTabs — the five plain-English category verbs for /discover:
 * EAT / FIX / MOVE / SHOP / BOOK. Replaces the old 8-category pill strip.
 *
 * Active tab = --mint-fill pill with ink text; inactive = muted chip with
 * a hairline border and secondary text (the brief's chip treatment).
 * Horizontal, scrollable on every viewport — same pattern as the rail it
 * replaces; a leading glyph fronts each verb.
 */

import { VERBS, type VerbId } from "../../lib/discover/verbs";

export function VerbTabs({
  active,
  onSelect,
}: {
  active: VerbId;
  onSelect: (id: VerbId) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
      <div className="flex w-max items-center gap-2">
        {VERBS.map((verb) => {
          const isActive = active === verb.id;
          return (
            <button
              key={verb.id}
              type="button"
              onClick={() => onSelect(verb.id)}
              aria-pressed={isActive}
              className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.1em] transition ${
                isActive
                  ? "border-transparent bg-mint-fill text-mint-fill-ink"
                  : "border-default bg-surface-muted text-secondary hover:border-strong hover:text-primary"
              }`}
            >
              <span aria-hidden="true" className="text-sm">{verb.glyph}</span>
              <span>{verb.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
