"use client";

/**
 * PopInSeller — small floating bubble UI for the embed page.
 *
 * Pure presentation. The PopInSellerHost owns trigger logic +
 * analytics; this component only renders the bubble + handles user
 * interactions through callback props.
 *
 * MVP shape (Mode C — static poster + greeting + offer chip):
 *   ┌──────────────────────────────────────────┐
 *   │  [avatar]  Welcome to Topgun Maintenance.│  ×
 *   │            Today's featured offer:       │
 *   │            ──────────────────────────    │
 *   │            Full Detail Package  $89  →   │
 *   └──────────────────────────────────────────┘
 *
 * Sits at fixed bottom-right, z-[35] — below the mobile sticky
 * buy bar (z-40) and DumPill (z-[100]), above the embedded chat
 * (z-10). Slide-in on mount, fade-out on dismiss.
 *
 * Mode A (live IVS) and Mode B (recorded video) are deliberately
 * out of scope for this MVP; the host can pass an `avatarUrl` for
 * future poster-frame support without component changes.
 */

import { useEffect, useState } from "react";

export type PopInOffer = {
  id: string;
  title: string;
  price_usd: number;
};

type PopInSellerProps = {
  greeting: string;
  merchantName: string;
  avatarUrl?: string | null;
  offer: PopInOffer | null;
  onOfferClick: () => void;
  onDismiss: () => void;
};

export function PopInSeller({
  greeting,
  merchantName,
  avatarUrl,
  offer,
  onOfferClick,
  onDismiss,
}: PopInSellerProps) {
  // Slide-in animation gate. We render `mounted=false` for one frame
  // so the initial transform applies before transitioning to the
  // resting position.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 16);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      role="dialog"
      aria-label={`Greeting from ${merchantName}`}
      className={[
        "pointer-events-auto fixed bottom-20 right-4 z-[35] w-[320px] max-w-[calc(100vw-2rem)]",
        "rounded-2xl border border-default bg-surface-card shadow-[0_12px_40px_rgba(11,18,32,0.18)] backdrop-blur-md",
        "transition-all duration-300 ease-out",
        mounted
          ? "translate-y-0 opacity-100"
          : "translate-y-3 opacity-0",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-secondary transition hover:bg-surface-muted hover:text-primary"
      >
        ×
      </button>

      <div className="flex items-start gap-3 p-4 pr-9">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-default bg-brand-teal-soft">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-sm font-bold text-brand-navy">
              {initialsOf(merchantName)}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-primary">{greeting}</p>

          {offer ? (
            <button
              type="button"
              onClick={onOfferClick}
              className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl border border-default bg-brand-teal-soft px-3 py-2.5 text-left transition hover:border-brand-teal"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-teal">
                  Featured offer
                </div>
                <div className="mt-0.5 truncate text-sm font-semibold text-brand-navy">
                  {offer.title}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-bold text-brand-navy">
                  ${offer.price_usd.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
                <div className="text-[10px] font-semibold text-brand-teal">
                  View →
                </div>
              </div>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
