"use client";

/**
 * VerbTabs — the category pill row for "The Club" home: a leading "For you"
 * (everything) pill followed by the five plain-English verbs
 * (EAT / FIX / MOVE / SHOP / BOOK).
 *
 * Mock styling: the active pill is a near-black fill with white text; inactive
 * pills are white with a hairline border. (Mint stays reserved for actions
 * like Follow/Buy — a category selector isn't an action, so it goes neutral.)
 * Horizontal, scrollable on every viewport.
 */

import { VERBS, type VerbId } from "../../lib/discover/verbs";

// "all" = the "For you" pill (no verb filter). Everything else is a verb.
export type VerbTabId = VerbId | "all";

const PILLS: { id: VerbTabId; label: string; glyph?: string }[] = [
  { id: "all", label: "For you" },
  ...VERBS.map((v) => ({ id: v.id as VerbTabId, label: v.label, glyph: v.glyph })),
];

export function VerbTabs({
  active,
  onSelect,
}: {
  active: VerbTabId;
  onSelect: (id: VerbTabId) => void;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0">
      <div className="flex w-max items-center gap-2">
        {PILLS.map((pill) => {
          const isActive = active === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              onClick={() => onSelect(pill.id)}
              aria-pressed={isActive}
              className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-4 py-2 text-[13px] font-semibold transition ${
                isActive
                  ? "border-transparent bg-surface-inverse text-white"
                  : "border-default bg-surface-card text-primary hover:border-strong"
              }`}
            >
              {pill.glyph && <span aria-hidden="true" className="text-sm">{pill.glyph}</span>}
              <span>{pill.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
