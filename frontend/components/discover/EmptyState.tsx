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
      <div className="rounded-xl border border-[var(--state-live)]/30 bg-red-500/5 p-8 text-center">
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
      <div className="rounded-xl border border-default bg-surface-muted p-8 text-center">
        <p className="text-sm text-secondary">No live shows right now.</p>
        {onClearLive && (
          <button
            onClick={onClearLive}
            className="mt-3 text-xs font-medium text-brand-teal transition hover:text-brand-teal"
          >
            View all sellers →
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-default bg-surface-muted p-8 text-center">
      <p className="text-sm text-secondary">
        No matches. Try clearing filters or widening your search.
      </p>
      {onClearFilters && (
        <button
          onClick={onClearFilters}
          className="mt-3 rounded-lg border border-default px-4 py-2 text-xs font-bold uppercase tracking-[0.08em] text-primary transition hover:border-strong hover:text-primary"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
