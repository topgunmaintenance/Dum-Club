"use client";

/**
 * Empty state variants for /discover grid.
 */

type EmptyStateProps = {
  variant: "no-results" | "no-live" | "error" | "no-listings";
  errorMessage?: string;
  onClearFilters?: () => void;
  onClearLive?: () => void;
  onRetry?: () => void;
};

export function EmptyState({ variant, errorMessage, onClearFilters, onClearLive, onRetry }: EmptyStateProps) {
  // Genuine zero-data state (no merchants live yet, cold start). Shown
  // instead of a perpetual loading skeleton or a "no matches" message
  // when the API returns zero listings and there's nothing to filter.
  if (variant === "no-listings") {
    return (
      <div className="rounded-2xl border border-default bg-surface-card p-10 text-center">
        <h2 className="text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl">
          We&apos;re onboarding our first local businesses.
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-secondary">
          Be the first in your category.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3">
          <a
            href="/merchant"
            className="inline-flex items-center justify-center rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
          >
            Put your shop on air →
          </a>
          <a
            href="/about#contact"
            className="text-[12px] font-bold uppercase tracking-[0.12em] text-secondary transition hover:text-brand-teal"
          >
            Talk to the founder →
          </a>
        </div>
      </div>
    );
  }

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
