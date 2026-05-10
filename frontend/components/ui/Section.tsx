"use client";

/**
 * Section — vertical-rhythm wrapper, design-system primitive.
 *
 * spacing:
 *   tight    py-8  lg:py-12   (compact between-content blocks)
 *   default  py-16 lg:py-24   (standard section breathing room)
 *   loose    py-24 lg:py-32   (hero-adjacent, marketing pages)
 *
 * bg: page | card | muted | gradient | inverse | none
 *   page      surface-page                 (default; consistent with body)
 *   card      surface-card                 (white block on coloured page)
 *   muted     surface-muted                (subtle interruption strip)
 *   gradient  bg-gradient-mesh utility     (warm teal+navy radial mesh)
 *   inverse   surface-inverse + text-white (dark contrast section)
 *   none      no background                (composes inside a parent)
 *
 * Renders a semantic <section> by default; pass `as` to render
 * <div> when nesting forbids another section.
 */

import {
  forwardRef,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type SectionSpacing = "tight" | "default" | "loose";
type SectionBg = "page" | "card" | "muted" | "gradient" | "inverse" | "none";

export type SectionProps = HTMLAttributes<HTMLElement> & {
  spacing?: SectionSpacing;
  bg?: SectionBg;
  as?: "section" | "div" | "article";
  children?: ReactNode;
};

const SPACING: Record<SectionSpacing, string> = {
  tight: "py-8 lg:py-12",
  default: "py-16 lg:py-24",
  loose: "py-24 lg:py-32",
};

const BG: Record<SectionBg, string> = {
  page: "bg-surface-page text-primary",
  card: "bg-surface-card text-primary",
  muted: "bg-surface-muted text-primary",
  gradient: "bg-gradient-mesh text-primary",
  inverse: "bg-surface-inverse text-white",
  none: "",
};

export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  { spacing = "default", bg = "page", as = "section", className, children, ...rest },
  ref,
) {
  const Tag = as as ElementType;
  const cls = [SPACING[spacing], BG[bg], className ?? ""]
    .filter(Boolean)
    .join(" ");
  // ref cast: Tag is constrained to section/div/article — all three
  // share HTMLElement at runtime; the cast just bridges the
  // structural-typing gap React's polymorphic helpers don't model.
  return (
    <Tag ref={ref as React.Ref<HTMLElement>} className={cls} {...rest}>
      {children}
    </Tag>
  );
});
