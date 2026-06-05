"use client";

/**
 * MerchantNextStep — single source of truth for "what should this
 * merchant do next?" Replaces the divergent primary-action surfaces
 * that used to live on /dashboard (Post & Go Live card) and /merchant
 * (5-step checklist).
 *
 * Renders one of two layouts:
 *   variant="card"    — full-width dashboard card with completed-steps
 *                       row + headline + subhead + primary CTA +
 *                       optional secondary CTA. Used on /dashboard
 *                       and /merchant.
 *   variant="compact" — single-line floating widget for the project
 *                       owner-view (small footprint, doesn't compete
 *                       with the storefront content).
 *
 * Pure presentational. All state derivation lives in
 * `lib/merchantState.ts:deriveMerchantState` — this component just
 * renders the result. Consumers pass the inputs they already have
 * from the page's existing data fetches; no new network calls.
 */

import Link from "next/link";

import {
  MerchantState,
  MerchantStateInputs,
  deriveMerchantState,
  stepLabel,
} from "../lib/merchantState";

type Props = {
  inputs: MerchantStateInputs;
  /** Render mode. */
  variant?: "card" | "compact";
  /** Optional override for the card eyebrow. Defaults to the
   *  lifecycle-state label ("Next step", "Keep selling", etc.). */
  eyebrow?: string;
  /** When true, hides the completed-steps row. Useful in compact
   *  variant or when the surrounding UI already shows progress
   *  elsewhere. */
  hideCompleted?: boolean;
  /** When set AND the current step is `share_shop`, the primary
   *  "Share Shop" CTA renders disabled with this string as a tooltip.
   *  Used to block sharing a storefront whose public profile
   *  (description + category) isn't filled in yet. Only affects the
   *  share_shop step; every other step's CTA stays a live link. */
  shareDisabledReason?: string;
};

function CompletedRow({ state }: { state: MerchantState }) {
  if (state.completed.length === 0) return null;
  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-secondary">
      {state.completed.map((s) => (
        <li key={s} className="inline-flex items-center gap-1.5">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-teal/15 text-[9px] font-bold text-brand-teal">
            ✓
          </span>
          <span>{stepLabel(s)}</span>
        </li>
      ))}
    </ul>
  );
}

function eyebrowFor(state: MerchantState, override?: string): string {
  if (override) return override;
  switch (state.lifecycleState) {
    case "new":           return "Next step";
    case "first_offer":   return "Next step";
    case "first_sale":    return "Keep selling";
    case "power_seller":  return "Grow your shop";
  }
}

export function MerchantNextStep({
  inputs,
  variant = "card",
  eyebrow,
  hideCompleted,
  shareDisabledReason,
}: Props) {
  const state = deriveMerchantState(inputs);

  // Gate the Share Shop CTA when the profile isn't complete. Only the
  // share_shop step is affected — other steps' CTAs are never blocked.
  const shareGated = state.step === "share_shop" && Boolean(shareDisabledReason);

  if (variant === "compact") {
    return (
      <div className="rounded-2xl border border-default bg-surface-card px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-brand-teal/80">
              {eyebrowFor(state, eyebrow)}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-primary">
              {state.headline}
            </div>
          </div>
          {shareGated ? (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={shareDisabledReason}
              className="shrink-0 cursor-not-allowed rounded-lg bg-surface-muted px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-muted"
            >
              {state.nextAction.label} →
            </button>
          ) : (
            <Link
              href={state.nextAction.href}
              className="shrink-0 rounded-lg bg-brand-teal px-3 py-2 text-xs font-bold uppercase tracking-[0.1em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              {state.nextAction.label} →
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Card variant — default.
  return (
    <div className="mb-8 rounded-3xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-6 sm:p-8">
      {!hideCompleted && <CompletedRow state={state} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-teal">
            {eyebrowFor(state, eyebrow)}
          </div>
          <div className="mt-2 text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl">
            {state.headline}
          </div>
          <p className="mt-1 text-sm text-secondary">{state.subhead}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:shrink-0">
          {state.secondaryAction && (
            <Link
              href={state.secondaryAction.href}
              className="rounded-xl border border-default bg-surface-card px-4 py-2.5 text-sm font-bold text-primary transition hover:border-brand-teal hover:text-brand-teal"
            >
              {state.secondaryAction.label}
            </Link>
          )}
          {shareGated ? (
            <button
              type="button"
              disabled
              aria-disabled="true"
              title={shareDisabledReason}
              className="cursor-not-allowed rounded-xl bg-surface-muted px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-muted"
            >
              {state.nextAction.label} →
            </button>
          ) : (
            <Link
              href={state.nextAction.href}
              className="rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
            >
              {state.nextAction.label} →
            </Link>
          )}
        </div>
      </div>
      {shareGated && (
        <p className="mt-3 text-xs font-medium text-secondary">
          {shareDisabledReason}
        </p>
      )}
    </div>
  );
}
