"use client";

/**
 * Trust strip — Phase 8 light-theme + live numbers.
 *
 * Wired to GET /api/projects/live-stats so the merchant counts and
 * offer counts come from the database, not static copy. CLAUDE.md
 * §12 rule 2 forbids fake numbers — when the endpoint hasn't
 * loaded or returns zeros, we fall back to the original
 * non-numeric trust statements so the strip never displays
 * empty-but-implying values.
 *
 * No claims of buyer protection (no policy yet).
 * No points copy (§12 Rule 4).
 */

import { Lock, BadgeCheck, Building2 } from "lucide-react";
import { useLiveStats } from "../../lib/discover/useLiveStats";

export function TrustStrip() {
  const { stats } = useLiveStats();

  // Item 1: Stripe-secured checkout — non-numeric, always-on truth.
  // Item 2: verified merchants — show count if we have ≥1; otherwise
  //         non-numeric fallback that still names the trust signal.
  // Item 3: active offers — show count if ≥1; fall back to neutral
  //         "Live storefronts" copy if the platform is empty.
  const verifiedLabel =
    stats && stats.verified_merchants > 0
      ? `${stats.verified_merchants} verified founding merchant${stats.verified_merchants === 1 ? "" : "s"}`
      : "Founding merchants personally verified";

  const offerLabel =
    stats && stats.active_offers > 0
      ? `${stats.active_offers} active offer${stats.active_offers === 1 ? "" : "s"}`
      : "Sellers paid direct via Stripe Connect";

  return (
    <div className="mb-6 flex items-center gap-6 overflow-x-auto rounded-xl border border-default bg-surface-card px-5 py-3 text-[12px] text-secondary sm:gap-8 sm:text-[13px] [&::-webkit-scrollbar]:hidden">
      <div className="flex flex-shrink-0 items-center gap-2 text-primary">
        <Lock className="h-4 w-4 text-brand-teal" strokeWidth={2} aria-hidden="true" />
        <span>Stripe-secured checkout</span>
      </div>
      <div className="h-3 w-px flex-shrink-0 bg-default" style={{ backgroundColor: "var(--border-default)" }} />
      <div className="flex flex-shrink-0 items-center gap-2 text-primary">
        <Building2 className="h-4 w-4 text-brand-teal" strokeWidth={2} aria-hidden="true" />
        <span>{offerLabel}</span>
      </div>
      <div className="h-3 w-px flex-shrink-0" style={{ backgroundColor: "var(--border-default)" }} />
      <div className="flex flex-shrink-0 items-center gap-2 text-primary">
        <BadgeCheck className="h-4 w-4 text-brand-teal" strokeWidth={2} aria-hidden="true" />
        <span>{verifiedLabel}</span>
      </div>
    </div>
  );
}
