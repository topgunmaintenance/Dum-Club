"use client";

/**
 * Button — DUM Club design-system primitive.
 *
 * Variants: primary, secondary, ghost, danger, link.
 * Sizes: sm (36px), md (44px / default), lg (52px).
 * Loading state shows a spinner and locks the button.
 *
 * Polymorphic: renders <a> when href is provided, otherwise
 * <button>. Both branches forwardRef so consumers can attach
 * focus/scroll handlers without rendering wrappers.
 *
 * Focus ring is standardised via a focus-visible: utility chain
 * so keyboard users see a consistent affordance across every CTA.
 */

import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonSize = "sm" | "md" | "lg";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
  className?: string;
};

type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    href?: undefined;
  };

type ButtonAsAnchor = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | "href"> & {
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

// Tailwind class strings literal in source so the JIT picks them up.
// Don't refactor into bracket-notation lookups — Tailwind's content
// scanner reads strings, not runtime values.
// primary is the handoff emerald fill with near-black ink (the two-mint
// legibility split, CLAUDE.md §8); danger is the coral Go Live / urgency
// fill. Both resolve through the design tokens repointed in globals.css.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-mint-fill text-mint-fill-ink hover:opacity-90 active:opacity-80",
  secondary:
    "bg-surface-card text-primary border border-default hover:border-strong hover:bg-surface-muted",
  ghost:
    "bg-transparent text-secondary hover:text-primary hover:bg-surface-muted",
  danger: "bg-state-live text-white hover:opacity-90 active:opacity-80",
  link: "bg-transparent text-mint-text hover:underline underline-offset-4 px-0",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-[12px]", //          36px
  md: "h-11 px-5 text-sm", //             44px (default — accessibility minimum)
  lg: "h-[52px] px-6 text-[15px]", //     52px
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-tight " +
  "transition-colors transition-shadow duration-150 ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "motion-reduce:transition-none";

function classes(
  variant: ButtonVariant,
  size: ButtonSize,
  fullWidth: boolean,
  extra?: string,
) {
  return [
    BASE,
    VARIANT[variant],
    SIZE[size],
    fullWidth ? "w-full" : "",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const Button = forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  ButtonProps
>(function Button(props, ref) {
  const {
    variant = "primary",
    size = "md",
    loading = false,
    fullWidth = false,
    className,
    children,
    ...rest
  } = props;

  const cls = classes(variant, size, fullWidth, className);

  const content = loading ? (
    <>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span className="opacity-80">{children}</span>
    </>
  ) : (
    children
  );

  // Anchor branch — href narrows the prop union.
  if ("href" in rest && typeof rest.href === "string") {
    const { href, ...anchorRest } = rest as { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        className={cls}
        aria-busy={loading || undefined}
        {...anchorRest}
      >
        {content}
      </a>
    );
  }

  const buttonRest = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={buttonRest.type ?? "button"}
      className={cls}
      aria-busy={loading || undefined}
      disabled={buttonRest.disabled || loading}
      {...buttonRest}
    >
      {content}
    </button>
  );
});
