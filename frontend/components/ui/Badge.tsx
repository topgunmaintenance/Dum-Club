"use client";

/**
 * Badge — small status pill, design-system primitive.
 *
 * Variants map to DUM Club semantic states:
 *   verified  — bg-brand-teal-soft + brand-navy text     (trust signal)
 *   live      — state-live tinted bg + state-live text  (now-happening)
 *   muted     — surface-muted + secondary text          (neutral chip)
 *   accent    — solid brand-teal + white text            (attention)
 *   navy      — solid brand-navy + white text            (authority)
 *
 * Sizes: sm | md.
 *
 * Optional `dot` shows a leading status dot. When variant is "live"
 * and dot is true, the dot adds the animate-ping halo so the badge
 * reads as "happening right now" — same pattern as the Discover
 * ListingCard LIVE pill.
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

type BadgeVariant =
  | "verified"
  | "live"
  | "muted"
  | "accent"
  | "navy"
  | "founding"
  | "dum";
type BadgeSize = "sm" | "md";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children?: ReactNode;
};

// Mapped to the June 2026 handoff badge kit: VERIFIED (emerald on mint),
// LIVE (coral on pale coral), FOUNDING (mono on muted), DUM (dark pill).
const VARIANT: Record<BadgeVariant, string> = {
  verified: "bg-mint-card text-mint-text border border-mint-card-border",
  live: "bg-coral-bg text-coral border border-transparent",
  muted: "bg-surface-muted text-secondary border border-default",
  accent: "bg-mint-fill text-mint-fill-ink border border-transparent",
  navy: "bg-brand-navy text-white border border-transparent",
  founding: "bg-surface-muted text-secondary border border-default",
  dum: "bg-dum-navy-card text-white border border-transparent",
};

const SIZE: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[9px]",
  md: "px-2 py-0.5 text-[11px]",
};

const DOT_BG: Record<BadgeVariant, string> = {
  verified: "bg-mint-fill",
  live: "bg-coral",
  muted: "bg-secondary",
  accent: "bg-mint-fill-ink",
  navy: "bg-white",
  founding: "bg-secondary",
  dum: "bg-dum-live-accent",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = "muted", size = "md", dot = false, className, children, ...rest },
  ref,
) {
  const cls = [
    "inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-[0.08em]",
    VARIANT[variant],
    SIZE[size],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={ref} className={cls} {...rest}>
      {dot && (
        <span className="relative flex h-2 w-2" aria-hidden="true">
          {variant === "live" && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${DOT_BG[variant]}`}
            />
          )}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${DOT_BG[variant]}`}
          />
        </span>
      )}
      {children}
    </span>
  );
});
