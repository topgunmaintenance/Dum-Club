"use client";

/**
 * AdminBar — slim floating top bar visible only to the merchant
 * who owns the project they're viewing on /project/[id].
 *
 * Replaces the cluttered owner controls that previously lived
 * inline on each card. The bar surfaces the four owner actions
 * the merchant uses every visit (Go Live, Edit Offers, Orders,
 * Settings) plus a "View as Customer" toggle that hides the bar
 * for the rest of the session — useful for previewing what a
 * real visitor sees.
 *
 * Constraints honoured (per directive):
 *   - 44px tall, neutral background, subtle border-bottom
 *   - Sits BELOW the global nav (top-14 = below SiteChrome's
 *     56px navbar; tweak if SiteChrome ever resizes)
 *   - "Go Live" links to the existing IVSStageHost block on the
 *     same page via #project-live-host anchor — does NOT spawn
 *     a new live system
 *   - Other links route to /project/[slug]/manage with section
 *     hashes the manage page can scroll to once those sections
 *     land there
 *   - "View as Customer" persists per-project in sessionStorage
 *     so a SPA navigation within the tab keeps the choice
 *
 * Visibility contract:
 *   isOwner = true AND viewAsCustomer = false → bar visible
 *   isOwner = true AND viewAsCustomer = true  → bar hidden,
 *                                               sessionStorage
 *                                               key set so other
 *                                               owner-only UI
 *                                               (ellipsis menus
 *                                               on offer cards)
 *                                               can also gate
 *                                               on the same flag
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export const VIEW_AS_CUSTOMER_EVENT = "dum-view-as-customer-change";

function viewAsCustomerKey(projectSlug: string): string {
  return `dum-view-as-customer:${projectSlug}`;
}

/**
 * Read the current "View as Customer" flag for a project from
 * sessionStorage. Defaults to false (admin UI visible). Safe to
 * call from any client component — degrades to false if
 * sessionStorage is unavailable (private browsing).
 */
export function readViewAsCustomer(projectSlug: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(viewAsCustomerKey(projectSlug)) === "1";
  } catch {
    return false;
  }
}

/**
 * Hook that mirrors readViewAsCustomer into React state and
 * subscribes to changes via the custom DOM event the AdminBar
 * dispatches on toggle. Use in components that need to hide
 * owner-only chrome (e.g., the offer-card ellipsis menu) when
 * the merchant is previewing.
 */
export function useViewAsCustomer(projectSlug: string): boolean {
  const [viewAsCustomer, setViewAsCustomer] = useState<boolean>(false);
  useEffect(() => {
    setViewAsCustomer(readViewAsCustomer(projectSlug));
    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ slug: string; value: boolean }>).detail;
      if (!detail || detail.slug !== projectSlug) return;
      setViewAsCustomer(detail.value);
    }
    window.addEventListener(VIEW_AS_CUSTOMER_EVENT, onChange as EventListener);
    return () => {
      window.removeEventListener(
        VIEW_AS_CUSTOMER_EVENT,
        onChange as EventListener,
      );
    };
  }, [projectSlug]);
  return viewAsCustomer;
}

interface AdminBarProps {
  /** Project slug or id used to route to /project/[slug]/manage */
  projectSlug: string;
  /** Number of orders to surface in the "Orders (N)" pill. Pass
   *  0 to omit the count. */
  orderCount: number;
  /** Whether the merchant is currently broadcasting. When true
   *  the Go Live button reads "Live now" + scrolls to the host
   *  block instead of triggering a new stream. */
  isLive: boolean;
}

export function AdminBar({ projectSlug, orderCount, isLive }: AdminBarProps) {
  const [hidden, setHidden] = useState<boolean>(false);

  // Hydrate from sessionStorage on mount (and re-check on slug
  // change so navigating between projects doesn't bleed state).
  useEffect(() => {
    setHidden(readViewAsCustomer(projectSlug));
  }, [projectSlug]);

  const enableViewAsCustomer = useCallback(() => {
    setHidden(true);
    try {
      window.sessionStorage.setItem(viewAsCustomerKey(projectSlug), "1");
    } catch {
      // private browsing — degrade silently, the bar still
      // hides until the visitor reloads
    }
    try {
      window.dispatchEvent(
        new CustomEvent(VIEW_AS_CUSTOMER_EVENT, {
          detail: { slug: projectSlug, value: true },
        }),
      );
    } catch {
      // no-op
    }
  }, [projectSlug]);

  const goLiveHref = `#project-live-host`;

  if (hidden) return null;

  return (
    <div
      role="toolbar"
      aria-label="Owner admin bar"
      className="fixed left-0 right-0 top-14 z-40 flex h-11 items-center gap-2 border-b border-default bg-surface-card/95 px-4 text-sm backdrop-blur supports-[backdrop-filter]:bg-surface-card/80"
      data-dum-admin-bar
    >
      <a
        href={goLiveHref}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-bold uppercase tracking-[0.06em] text-brand-navy transition hover:bg-brand-teal-hover"
      >
        <span
          className={`relative inline-flex h-2 w-2 ${isLive ? "" : "opacity-70"}`}
          aria-hidden="true"
        >
          {isLive && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-navy/60" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-navy" />
        </span>
        {isLive ? "Live now" : "Go Live"}
      </a>

      <Link
        href={`/project/${projectSlug}/manage#offers`}
        className="rounded-lg border border-default bg-transparent px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary"
      >
        Edit offers
      </Link>

      <Link
        href={`/project/${projectSlug}/manage#orders`}
        className="rounded-lg border border-default bg-transparent px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary"
      >
        Orders{orderCount > 0 ? ` (${orderCount})` : ""}
      </Link>

      <Link
        href={`/project/${projectSlug}/manage#settings`}
        className="rounded-lg border border-default bg-transparent px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary"
      >
        Settings
      </Link>

      <button
        type="button"
        onClick={enableViewAsCustomer}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-primary"
        aria-label="Hide admin bar and view this page as a customer"
      >
        <span aria-hidden="true">👁</span>
        View as customer
      </button>
    </div>
  );
}
