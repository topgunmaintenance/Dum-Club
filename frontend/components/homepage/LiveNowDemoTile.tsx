/**
 * LiveNowDemoTile — bridge-measure placeholder for the homepage's Live Now
 * rail, shown ONLY while zero real businesses are currently live (see
 * CLAUDE.md §12 rule 2's narrow exception). Never says "LIVE", never uses
 * the coral live-status color, never shows a fake viewer count — it's
 * unmistakably an example, not a real broadcast.
 *
 * Data-driven, not a manual toggle: the parent only renders this when the
 * real live-projects list is empty, so it disappears on its own the moment
 * an actual business goes live. Delete this file + its one usage in
 * components/discover/ClubHome.tsx (homeVariant gate) once real live
 * sellers are consistently present.
 */

import Link from "next/link";

export function LiveNowDemoTile() {
  return (
    <Link
      href="/merchant"
      className="group flex w-full items-center gap-4 rounded-2xl border border-dashed border-default bg-surface-card p-4 transition hover:border-strong sm:max-w-md"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-mint-card to-surface-muted text-2xl">
        📹
      </span>
      <span className="min-w-0">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
          Demo preview
        </span>
        <span className="mt-1 block text-sm font-bold text-primary">
          This is what it looks like when a shop goes live
        </span>
        <span className="mt-0.5 block text-[12px] font-semibold text-mint-text group-hover:underline">
          Be the first to go live →
        </span>
      </span>
    </Link>
  );
}
