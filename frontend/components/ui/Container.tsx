"use client";

/**
 * Container — horizontal max-width wrapper, design-system primitive.
 *
 * Sizes:
 *   sm    max-w-3xl   ~768px  (article / single-column form)
 *   md    max-w-5xl   ~1024px (default content)
 *   lg    max-w-7xl   ~1280px (homepage hero / wide grids)
 *   xl    max-w-[1440px]      (dashboard analytics)
 *   full  no max width        (full-bleed sections)
 *
 * Default padding ramps with viewport (px-4 sm:px-6 lg:px-8); pass
 * padding="none" to opt out when the container itself sits inside
 * something that already pads.
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

type ContainerSize = "sm" | "md" | "lg" | "xl" | "full";
type ContainerPadding = "default" | "none";

export type ContainerProps = HTMLAttributes<HTMLDivElement> & {
  size?: ContainerSize;
  padding?: ContainerPadding;
  children?: ReactNode;
};

const SIZE: Record<ContainerSize, string> = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-7xl",
  xl: "max-w-[1440px]",
  full: "max-w-none",
};

export const Container = forwardRef<HTMLDivElement, ContainerProps>(
  function Container(
    { size = "md", padding = "default", className, children, ...rest },
    ref,
  ) {
    const cls = [
      "mx-auto w-full",
      SIZE[size],
      padding === "default" ? "px-4 sm:px-6 lg:px-8" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div ref={ref} className={cls} {...rest}>
        {children}
      </div>
    );
  },
);
