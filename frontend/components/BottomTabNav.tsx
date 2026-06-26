"use client";

/**
 * BottomTabNav — mobile app-shell tab bar (the Club mock's bottom nav):
 * Home / Live / + / Bag / You. Mobile-only (lg:hidden); desktop keeps the top
 * navbar.
 *
 * Hidden on surfaces that own their own bottom chrome or aren't buyer-facing:
 * the storefront (/project/* has the sticky buy bar + the immersive room), the
 * embed iframe, and the admin/dashboard/dev/auth tooling. A spacer reserves
 * the bar's height so page content (and the footer) never hide behind it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Radio, Plus, ShoppingBag, User } from "lucide-react";

const HIDE_PREFIXES = ["/embed", "/admin", "/_dev", "/auth", "/dashboard", "/project/"];

function isHidden(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

type Tab = {
  href: string;
  label: string;
  Icon: typeof Home;
  match: (p: string) => boolean;
};

const TABS: Tab[] = [
  { href: "/", label: "Home", Icon: Home, match: (p) => p === "/" },
  { href: "/discover", label: "Live", Icon: Radio, match: (p) => p.startsWith("/discover") },
  { href: "/orders", label: "Bag", Icon: ShoppingBag, match: (p) => p.startsWith("/orders") },
  // "You" → the buyer's own surface (followed shops), not the merchant
  // dashboard. Signed-out lands on /clubs' sign-in prompt. Merchants reach
  // their dashboard from the top navbar.
  { href: "/clubs", label: "You", Icon: User, match: (p) => p.startsWith("/clubs") },
];

export function BottomTabNav() {
  const pathname = usePathname();
  if (isHidden(pathname)) return null;
  const path = pathname || "/";

  return (
    <>
      {/* Spacer reserves the bar's height in normal flow (mobile only). */}
      <div aria-hidden className="h-16 lg:hidden" />
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-surface-card/95 backdrop-blur-md lg:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto flex max-w-md items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {/* Two tabs, the elevated + create button, then two tabs. */}
          {TABS.slice(0, 2).map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(path)} />
          ))}

          <Link
            href="/merchant"
            aria-label="Start selling"
            className="relative -top-3 inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-surface-inverse text-white shadow-lg transition active:scale-90"
          >
            <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
          </Link>

          {TABS.slice(2).map((t) => (
            <TabLink key={t.href} tab={t} active={t.match(path)} />
          ))}
        </div>
      </nav>
    </>
  );
}

function TabLink({ tab, active }: { tab: Tab; active: boolean }) {
  const { Icon } = tab;
  return (
    <Link
      href={tab.href}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${
        active ? "text-mint-text" : "text-secondary hover:text-primary"
      }`}
    >
      <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
      {tab.label}
    </Link>
  );
}
