"use client";

/**
 * Heading — DUM Club design-system primitive.
 *
 * Renders a locked typographic scale (display/h1/h2/h3) decoupled
 * from the underlying semantic tag. Pass `as` to render a different
 * element while keeping the visual size — handy when an h2 needs
 * the display look (e.g. above-fold landing) or when an h1 needs
 * to render as a div for SEO routing reasons.
 *
 * Defaults:
 *   level="h1"
 *   as defaults to the same element as level when level is h1/h2/h3,
 *   and to "h1" when level is "display".
 *   Color defaults to text-primary; override via className.
 */

import {
  forwardRef,
  type HTMLAttributes,
  type ElementType,
  type ReactNode,
} from "react";

type HeadingLevel = "display" | "h1" | "h2" | "h3";
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "div" | "p";

export type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  level?: HeadingLevel;
  as?: HeadingTag;
  children?: ReactNode;
};

const LEVEL: Record<HeadingLevel, string> = {
  display:
    "text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]",
  h1: "text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-[1.1]",
  h2: "text-2xl sm:text-3xl font-bold tracking-tight leading-tight",
  h3: "text-xl sm:text-2xl font-bold tracking-tight",
};

const DEFAULT_TAG: Record<HeadingLevel, HeadingTag> = {
  display: "h1",
  h1: "h1",
  h2: "h2",
  h3: "h3",
};

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  function Heading(
    { level = "h1", as, className, children, ...rest },
    ref,
  ) {
    const Tag: ElementType = as ?? DEFAULT_TAG[level];
    const cls = ["text-primary", LEVEL[level], className ?? ""]
      .filter(Boolean)
      .join(" ");
    return (
      <Tag ref={ref} className={cls} {...rest}>
        {children}
      </Tag>
    );
  },
);
