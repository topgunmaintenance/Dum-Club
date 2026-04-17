"use client";

/**
 * Empty state variants for /discover grid.
 */

type EmptyStateProps = {
  variant: "no-results" | "no-live" | "error";
  errorMessage?: string;
  onClearFilters?: () => void;
  onClearLive?: () => void;
  onRetry?: () => void;
};

export function EmptyState({ variant, errorMessage, onClearFilters, onClearLive, onRetry }: EmptyStateProps) {
  if (variant === "error") {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
        <p className="text-sm text-red-300">
          {errorMessage || "We couldn't load listings. Refresh to try again."}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 rounded-lg bg-red-500/20 px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] text-red-400 transition hover:bg-red-500/30"
          >
            Refresh
          </button>
        )}
      </div>
    );
  }

  if (variant === "no-live") {
    return (
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-8 text-center">
        <p className="text-sm text-zinc-400">No live shows right now.</p>
        {onClearLive && (
          <button
            onClick={onClearLive}
            className="mt-3 text-xs font-medium text-emerald-400 transition hover:text-emerald-300"
          >
            View all sellers →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-8 text-center">
      <p className="text-sm text-zinc-400">
        No matches. Try clearing filters or widening your search.
      </p>
      {onClearFilters && (
        <button
          onClick={onClearFilters}
          className="mt-3 rounded-lg border border-zinc-700 px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] text-zinc-300 transition hover:border-zinc-500 hover:text-white"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
