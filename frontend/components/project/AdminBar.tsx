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

export function writeViewAsCustomer(projectSlug: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage.setItem(viewAsCustomerKey(projectSlug), "1");
    } else {
      window.sessionStorage.removeItem(viewAsCustomerKey(projectSlug));
    }
  } catch {
    // private browsing — degrade silently
  }
  try {
    window.dispatchEvent(
      new CustomEvent(VIEW_AS_CUSTOMER_EVENT, {
        detail: { slug: projectSlug, value },
      }),
    );
  } catch {
    // no-op
  }
}

/**
 * Exit-customer-view chip rendered separately from the AdminBar
 * so it can stay visible after the bar hides. Used by the
 * project page (mounted alongside AdminBar) so a merchant
 * previewing as a customer still has a one-click path back to
 * admin mode.
 */
export function ExitCustomerViewChip({
  projectSlug,
  isOwner,
}: {
  projectSlug: string;
  isOwner: boolean;
}) {
  const viewAsCustomer = useViewAsCustomer(projectSlug);
  if (!isOwner) return null;
  if (!viewAsCustomer) return null;
  return (
    <button
      type="button"
      onClick={() => writeViewAsCustomer(projectSlug, false)}
      aria-label="Exit customer view and show admin controls"
      className="fixed bottom-5 right-5 z-[55] inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-2.5 text-sm font-bold text-white shadow-[0_14px_32px_rgba(11,18,32,0.32)] transition hover:translate-y-[-1px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal sm:bottom-6 sm:right-6"
    >
      <span aria-hidden="true">←</span>
      Back to business view
    </button>
  );
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
  const [moreOpen, setMoreOpen] = useState<boolean>(false);

  // Hydrate from sessionStorage on mount (and re-check on slug
  // change so navigating between projects doesn't bleed state).
  useEffect(() => {
    setHidden(readViewAsCustomer(projectSlug));
  }, [projectSlug]);

  // Close the More dropdown on Escape; mobile users with a hardware
  // keyboard or external accessibility tech expect it.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const enableViewAsCustomer = useCallback(() => {
    setHidden(true);
    setMoreOpen(false);
    writeViewAsCustomer(projectSlug, true);
  }, [projectSlug]);

  // All admin actions target same-page anchors that already
  // exist in /project/[id]/page.tsx:
  //   #project-live-host  → IVSStageHost wrapper (line 4078)
  //   #offers-section     → offers grid (line 5268)
  //   #section-orders     → orders <details> (line 7077)
  // Previously Edit offers / Orders / Settings linked into
  // /project/[slug]/manage which doesn't carry the same surfaces
  // — the merchant landed on a near-empty page wondering where
  // their offers went. Same-page scroll lands on the actual
  // affordance the click promised.
  const goLiveHref = `#project-live-host`;
  const editOffersHref = `#offers-section`;
  const ordersHref = `#section-orders`;
  // Real business settings live at /merchant (business profile,
  // Stripe Connect, founding status). /manage is service/booking
  // specific. Route Settings there until /manage grows a settings
  // panel.
  const settingsHref = `/merchant`;

  if (hidden) return null;

  return (
    <div
      role="toolbar"
      aria-label="Owner admin bar"
      // Mobile: h-12 (48px) — slim enough to feel like a native
      // mobile action strip but still gives 4px breathing room above
      // and below the 40px (h-10) primary buttons. Down from PR #257's
      // h-14 (56px) which read as a dashboard chrome.
      // Desktop: h-11 (44px) unchanged.
      // Blur: `backdrop-blur-sm` (4px) instead of default `backdrop-blur`
      // (8px) — Android Chrome's filter implementation is heavier than
      // iOS Safari, the 8px variant rendered as a muddy smear behind
      // the bar. The 4px variant reads as a clean ~iOS-style frosted
      // surface on both platforms.
      // Background: /92 instead of /95 — a hair more transparent so
      // the content below shows through subtly, reinforcing the
      // "floating chrome" feel.
      // top-16 lg:top-20 sits the bar flush BELOW the global navbar
      // (Navbar is fixed top-0, h-16 lg:h-20). The old top-14 (56px)
      // tucked the bar — and the GO LIVE pill — under the 64/80px
      // navbar, which renders above it (navbar z-50 > bar z-40), so the
      // pill's top was clipped behind the navbar on mobile and desktop.
      className="fixed left-0 right-0 top-16 lg:top-20 z-40 flex h-12 items-center gap-2 border-b border-default bg-surface-card/92 px-3 text-sm backdrop-blur-sm supports-[backdrop-filter]:bg-surface-card/80 sm:h-11 sm:px-4"
      style={{
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
      }}
      data-dum-admin-bar
    >
      {/* ── Primary: GO LIVE ────────────────────────────────────── */}
      <a
        href={goLiveHref}
        aria-label={isLive ? "Scroll to live broadcast" : "Start a live broadcast"}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-teal px-3.5 text-xs font-bold uppercase tracking-[0.06em] text-brand-navy transition hover:bg-brand-teal-hover sm:h-7 sm:px-3 sm:py-1.5"
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

      {/* ── Primary: Orders (always visible) ────────────────────── */}
      <a
        href={ordersHref}
        className="inline-flex h-10 items-center rounded-lg border border-default bg-transparent px-3 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary sm:h-7 sm:px-3 sm:py-1.5"
      >
        Orders{orderCount > 0 ? ` (${orderCount})` : ""}
      </a>

      {/* ── Desktop-only secondary actions ──────────────────────── */}
      <a
        href={editOffersHref}
        className="hidden sm:inline-flex h-7 items-center rounded-lg border border-default bg-transparent px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary"
      >
        Post an item
      </a>

      <Link
        href={settingsHref}
        className="hidden sm:inline-flex h-7 items-center rounded-lg border border-default bg-transparent px-3 py-1.5 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary"
      >
        Setup & Stats
      </Link>

      {/* ── Mobile-only More menu ───────────────────────────────── */}
      <div className="relative ml-auto sm:hidden">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="More owner actions"
          className="inline-flex h-10 items-center justify-center rounded-lg border border-default bg-transparent px-3 text-xs font-semibold text-secondary transition hover:border-brand-teal/50 hover:text-primary"
        >
          <span className="mr-1.5">More</span>
          <span aria-hidden="true" className="text-base leading-none">⋯</span>
        </button>
        {moreOpen && (
          <>
            {/* Tap-outside backdrop. Transparent + behind the menu
                so the menu still receives clicks. */}
            <button
              type="button"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-[55] cursor-default bg-transparent"
            />
            <div
              role="menu"
              aria-label="More owner actions"
              className="absolute right-0 top-[calc(100%+8px)] z-[60] min-w-[220px] overflow-hidden rounded-xl border border-default bg-surface-card shadow-[0_18px_48px_rgba(11,18,32,0.22)]"
            >
              <a
                href={editOffersHref}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
                className="block px-4 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted"
              >
                Post an item
              </a>
              <Link
                href={settingsHref}
                role="menuitem"
                onClick={() => setMoreOpen(false)}
                className="block border-t border-default px-4 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted"
              >
                Setup &amp; Stats
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={enableViewAsCustomer}
                className="block w-full border-t border-default px-4 py-3 text-left text-sm font-semibold text-primary transition hover:bg-surface-muted"
              >
                <span aria-hidden="true" className="mr-1.5">👁</span>
                View as customer
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Desktop-only: View as customer ──────────────────────── */}
      <button
        type="button"
        onClick={enableViewAsCustomer}
        className="ml-auto hidden h-7 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-primary sm:inline-flex"
        aria-label="Hide admin bar and view this page as a customer"
      >
        <span aria-hidden="true">👁</span>
        View as customer
      </button>
    </div>
  );
}
