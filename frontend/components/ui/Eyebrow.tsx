"use client";

/**
 * Eyebrow — small uppercase label that sits above a section heading.
 *
 * Tones map to the DUM Club design system:
 *   brand  — text-brand-teal  (default; primary attention pull)
 *   muted  — text-secondary    (neutral context)
 *   navy   — text-brand-navy   (trust / authority)
 *   live   — text-state-live   (now-happening signal)
 *
 * The class string is locked (text-[11px] font-bold uppercase
 * tracking-[0.2em]) so eyebrows look identical everywhere.
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

type EyebrowTone = "brand" | "muted" | "navy" | "live";

export type EyebrowProps = HTMLAttributes<HTMLDivElement> & {
  tone?: EyebrowTone;
  children?: ReactNode;
};

const TONE: Record<EyebrowTone, string> = {
  brand: "text-mint-text",
  muted: "text-muted",
  navy: "text-brand-navy",
  live: "text-coral",
};

// Mono uppercase eyebrow — the handoff's section-label treatment
// (Space Mono on the prototype; Geist Mono here, per CLAUDE.md §8).
const BASE = "font-mono text-[11px] font-bold uppercase tracking-[0.14em]";

export const Eyebrow = forwardRef<HTMLDivElement, EyebrowProps>(
  function Eyebrow({ tone = "brand", className, children, ...rest }, ref) {
    const cls = [BASE, TONE[tone], className ?? ""].filter(Boolean).join(" ");
    return (
      <div ref={ref} className={cls} {...rest}>
        {children}
      </div>
    );
  },
);
