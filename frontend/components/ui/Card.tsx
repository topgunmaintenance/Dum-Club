"use client";

/**
 * Card — DUM Club design-system primitive.
 *
 * Variants:
 *   surface   — default white card with default border + shadow-sm
 *   elevated  — surface + shadow-md, for raised panels (modals, menus)
 *   inset     — bg-surface-muted, for nested panels inside another Card
 *   accent    — bg-brand-teal-soft, for highlight callouts
 *
 * Padding: none | sm | md | lg.
 *
 * `interactive` opts in to the Phase 8 ListingCard hover pattern
 * (border-strong, shadow-md, lift). Honours prefers-reduced-motion
 * via Tailwind's motion-reduce: variant.
 *
 * Polymorphic to <a> when href is provided, so the whole card can
 * be a link target without nesting <a> inside <a>. forwardRef on
 * both branches.
 */

import {
  forwardRef,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

type CardVariant = "surface" | "elevated" | "inset" | "accent";
type CardPadding = "none" | "sm" | "md" | "lg";

type CommonProps = {
  variant?: CardVariant;
  padding?: CardPadding;
  interactive?: boolean;
  children?: ReactNode;
  className?: string;
};

type CardAsDiv = CommonProps &
  Omit<HTMLAttributes<HTMLDivElement>, keyof CommonProps> & {
    href?: undefined;
  };

type CardAsAnchor = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | "href"> & {
    href: string;
  };

export type CardProps = CardAsDiv | CardAsAnchor;

const VARIANT: Record<CardVariant, string> = {
  surface: "bg-surface-card border border-default shadow-sm",
  elevated: "bg-surface-card border border-default shadow-md",
  inset: "bg-surface-muted border border-default",
  accent: "bg-brand-teal-soft border border-default",
};

const PADDING: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

const INTERACTIVE =
  "transition-all duration-200 ease-out " +
  "hover:border-strong hover:shadow-md hover:-translate-y-0.5 " +
  "motion-reduce:hover:translate-y-0 motion-reduce:transition-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]";

function classes(
  variant: CardVariant,
  padding: CardPadding,
  interactive: boolean,
  extra?: string,
) {
  return [
    "rounded-2xl",
    VARIANT[variant],
    PADDING[padding],
    interactive ? INTERACTIVE : "",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const Card = forwardRef<
  HTMLDivElement | HTMLAnchorElement,
  CardProps
>(function Card(props, ref) {
  const {
    variant = "surface",
    padding = "md",
    interactive = false,
    className,
    children,
    ...rest
  } = props;

  // Anchor cards are implicitly interactive; force the hover affordance
  // on so consumers don't need to pass both `href` and `interactive`.
  const isLink = "href" in rest && typeof rest.href === "string";
  const cls = classes(variant, padding, interactive || isLink, className);

  if (isLink) {
    const { href, ...anchorRest } = rest as {
      href: string;
    } & AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={cls}
        {...anchorRest}
      >
        {children}
      </a>
    );
  }

  const divRest = rest as HTMLAttributes<HTMLDivElement>;
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={cls}
      {...divRest}
    >
      {children}
    </div>
  );
});
