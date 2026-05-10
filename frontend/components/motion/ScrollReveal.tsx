"use client";

/**
 * ScrollReveal — drop-in fade+rise animation that fires once when
 * a section enters the viewport. Powered by framer-motion's
 * whileInView + viewport.once so the work happens entirely on
 * the client without a manual IntersectionObserver.
 *
 * Honors prefers-reduced-motion: when the OS setting is on, the
 * component renders as a plain div with the children visible at
 * their final state — no transform, no opacity ramp, no work.
 *
 * Designed to be cheap to scatter: keep it on section wrappers
 * (max-w container or rounded card) rather than every individual
 * child. The optional `delay` prop lets sibling instances stagger
 * naturally without a parent variant.
 */

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

type ScrollRevealProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
  // Forwarded so anchor links (#how-it-works etc) keep working when
  // the wrapped section had an id on its plain <div>.
  id?: string;
  // Distance the element travels up during the reveal, in px.
  // Smaller values feel premium; larger values feel showy. Default
  // 16 matches the existing CSS hero-fade-up curve.
  distance?: number;
  // Margin on the viewport detection box. Negative values delay
  // the reveal until the element is well inside the viewport;
  // positive values fire earlier. Default "-10% 0px" = trigger
  // when ~10% of the element is visible.
  rootMargin?: string;
};

export function ScrollReveal({
  children,
  delay = 0,
  className,
  id,
  distance = 16,
  rootMargin = "-10% 0px",
}: ScrollRevealProps) {
  const reduce = useReducedMotion();

  if (reduce) {
    // Pre-rendered final state. No motion library work, no
    // intersection observer; the section paints immediately.
    return (
      <div id={id} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: rootMargin }}
      transition={{
        duration: 0.6,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
