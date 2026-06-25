"use client";

/**
 * Navbar — global header. Rewritten in Phase 10 to consume the
 * Phase 9 design-system primitives (Button, Card) and the Phase 4
 * brand-teal + light-theme tokens. Drops every inline style={{}}
 * block and the uppercase-mono nav language; lands on sentence-
 * case Geist Sans + a single Button shape across every CTA.
 *
 * Behaviour preserved verbatim from the previous implementation:
 *   - mounted flag pattern so the auth-dependent right slot stays
 *     SSR-stable (server + first client render show nothing, then
 *     the post-mount render fills in).
 *   - useAuth() drives Privy + Google login/logout.
 *   - Latest-project fetch with the live + approved + !is_deleted
 *     filter; the Go Live CTA only renders when at least one
 *     Go-Live-eligible project exists.
 *   - User-menu dropdown dismissed by clicking outside any element
 *     marked with the data-user-menu attribute.
 *   - Mobile sheet rendered OUTSIDE the <nav> element so the nav's
 *     backdrop-blur containing block doesn't trap it (mobile menu
 *     would clip otherwise).
 *   - DUM Points pill stays hidden — CLAUDE.md §5 holds it for
 *     Phase 2.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { useAuth } from "../lib/auth/AuthContext";
import { API_BASE } from "../lib/apiBase";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

// Primary nav — three top-level destinations. Build / Dashboard /
// AI Chat live in the authenticated user dropdown, not here.
const PRIMARY_LINKS = [
  { href: "/discover", label: "Discover" },
  { href: "/pricing", label: "Pricing" },
  { href: "/business", label: "For Business" },
  { href: "/about", label: "About" },
];

// Items in the authenticated-user dropdown (and mirrored into the
// mobile sheet's Account section).
const USER_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/orders", label: "Orders" },
];

export function Navbar() {
  const path = usePathname();
  const { user, loading, login, logout } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [latestProjectId, setLatestProjectId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!user?.privyId) {
      setLatestProjectId(null);
      return;
    }
    async function loadProjects() {
      try {
        // Trailing slash is REQUIRED. The FastAPI route is registered
        // at /api/projects/ and the app has redirect_slashes=False,
        // so a slash-less URL 404s instead of redirecting.
        const res = await fetch(
          `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user!.privyId)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        const projects = Array.isArray(data) ? data : data.projects ?? [];
        // Merchant-role gate: only surface Go Live when the user owns
        // at least one project that's actually live-eligible
        // (status=live, review_status=approved, not deleted). Drafts
        // and pending projects don't qualify.
        const goLiveable = projects.filter(
          (p: { status?: string; review_status?: string; is_deleted?: boolean }) =>
            p &&
            p.status === "live" &&
            p.review_status === "approved" &&
            p.is_deleted !== true,
        );
        setLatestProjectId(
          goLiveable.length > 0 ? String(goLiveable[0].id) : null,
        );
      } catch {
        /* network errors are non-fatal — the Go Live CTA simply hides */
      }
    }
    loadProjects();
  }, [user]);

  // Close menus on route change.
  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [path]);

  // Mobile-menu accessibility: Escape closes it, Tab is trapped inside
  // the open drawer, and focus moves into the drawer on open. Restores
  // focus to the toggle button on close.
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const drawer = mobileMenuRef.current;
    if (!drawer) return;

    // Move focus into the drawer.
    const focusables = () =>
      Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  // Click-outside dismiss for the user dropdown. Anything inside an
  // element with data-user-menu is considered "inside the menu" and
  // doesn't trigger the close.
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-user-menu]")) setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  // Close the user dropdown on Escape for keyboard users.
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [userMenuOpen]);

  const shortEmail =
    user?.email && user.email.length > 26
      ? `${user.email.slice(0, 22)}...`
      : user?.email ?? null;

  const goLiveHref = latestProjectId
    ? `/project/${latestProjectId}?golive=1`
    : "/merchant";

  // "Your Clubs" is a signed-in-only destination (the viewer's followed
  // shops). Gated on `mounted && user` so the server / first client render
  // stays the base list (no hydration mismatch) and the link only appears
  // once auth resolves.
  const primaryLinks =
    mounted && user
      ? [...PRIMARY_LINKS, { href: "/clubs", label: "Your Clubs" }]
      : PRIMARY_LINKS;

  return (
    <>
      {/* ── Fixed header bar ──────────────────────────────────── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-default bg-surface-card/95 backdrop-blur-md">
        {/* Mobile bar — visible below lg breakpoint. */}
        <div className="flex h-16 items-center justify-between px-4 lg:hidden">
          <BrandMark size="mobile" />
          <button
            type="button"
            ref={menuButtonRef}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-haspopup="dialog"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-default text-secondary transition-colors hover:text-primary hover:border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
          >
            {menuOpen ? (
              <X className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Desktop bar — visible at lg+. */}
        <div className="hidden h-20 items-center gap-6 px-6 lg:flex lg:px-8">
          <BrandMark size="desktop" />
          <div className="flex flex-1 items-center justify-center gap-2">
            {primaryLinks.map((l) => {
              const active = path === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={[
                    "relative px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded-md",
                    active
                      ? "text-mint-text"
                      : "text-secondary hover:text-primary",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  {l.label}
                  {active && (
                    <span
                      className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-mint-text"
                      aria-hidden="true"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {mounted && (
              <>
                {user && latestProjectId && (
                  <Button
                    href={goLiveHref}
                    variant="danger"
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    <span
                      className="relative inline-flex h-2.5 w-2.5"
                      aria-hidden="true"
                    >
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                    </span>
                    Go Live
                  </Button>
                )}

                {loading ? (
                  <Button variant="secondary" size="md" disabled>
                    Loading…
                  </Button>
                ) : user ? (
                  <UserMenu
                    open={userMenuOpen}
                    onToggle={() => setUserMenuOpen((o) => !o)}
                    onItemClick={() => setUserMenuOpen(false)}
                    onLogout={() => {
                      setUserMenuOpen(false);
                      logout();
                    }}
                    label={shortEmail ?? "Account"}
                    activePath={path}
                  />
                ) : (
                  <Button variant="secondary" size="md" onClick={login}>
                    Sign in
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Mobile sheet — rendered OUTSIDE <nav> so the nav's
           backdrop-blur containing block doesn't clip it. ── */}
      {menuOpen && (
        <div
          id="mobile-menu"
          ref={mobileMenuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Main menu"
          tabIndex={-1}
          className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto bg-surface-card lg:hidden"
        >
          <div className="border-b border-default">
            {primaryLinks.map((l) => {
              const active = path === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOpen(false)}
                  className={[
                    "block border-b border-default px-5 py-4 text-base font-medium transition-colors",
                    active
                      ? "bg-brand-teal-soft text-brand-navy"
                      : "text-primary hover:bg-surface-muted hover:text-brand-teal focus-visible:text-brand-teal",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>

          {mounted && user && latestProjectId && (
            <div className="px-5 pt-5">
              <Button
                href={goLiveHref}
                variant="danger"
                size="lg"
                fullWidth
                onClick={() => setMenuOpen(false)}
              >
                <span
                  className="relative inline-flex h-2.5 w-2.5"
                  aria-hidden="true"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                </span>
                Go Live
              </Button>
            </div>
          )}

          {mounted && user && (
            <div className="px-5 pt-6">
              <div className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.2em] text-secondary">
                Account
              </div>
              <div className="overflow-hidden rounded-xl border border-default">
                {USER_LINKS.map((item) => {
                  const active = path === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={[
                        "block border-b border-default px-4 py-3 text-sm font-medium transition-colors last:border-b-0",
                        active
                          ? "bg-brand-teal-soft text-brand-navy"
                          : "text-primary hover:bg-surface-muted hover:text-brand-teal focus-visible:text-brand-teal",
                      ].join(" ")}
                      aria-current={active ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {mounted && (
            <div className="px-5 py-6">
              {loading ? (
                <Button variant="secondary" size="md" fullWidth disabled>
                  Loading…
                </Button>
              ) : user ? (
                <Button
                  variant="secondary"
                  size="md"
                  fullWidth
                  onClick={() => {
                    logout();
                    setMenuOpen(false);
                  }}
                >
                  Sign out
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  fullWidth
                  onClick={() => {
                    login();
                    setMenuOpen(false);
                  }}
                >
                  Sign in
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
// BrandMark — DUM (primary) + CLUB (brand-teal) wordmark with
// optional logo glyph. Mobile and desktop variants only differ in
// glyph size; the type sizes are within ~2px to keep the brand
// recognisable across breakpoints.
// ─────────────────────────────────────────────────────────────────

function BrandMark({ size }: { size: "mobile" | "desktop" }) {
  const isMobile = size === "mobile";
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded-md"
      aria-label="DUM Club. Drive Your Market"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dum-logo-icon.png"
        alt=""
        className={isMobile ? "h-7 w-auto" : "h-8 w-auto"}
        aria-hidden="true"
      />
      {/* Two-line lockup: wordmark on top, "Drive Your Market"
          tagline below. leading-tight clamps the row height so
          the navbar bar stays the same h-16 / h-20 it was
          before the tagline landed. */}
      <span className="flex flex-col leading-tight">
        <span
          className={[
            "font-bold tracking-tight",
            isMobile ? "text-[18px]" : "text-[20px]",
          ].join(" ")}
        >
          <span className="text-primary">DUM </span>
          <span className="text-brand-teal">CLUB</span>
        </span>
        <span
          className={[
            "font-medium uppercase text-brand-teal animate-[fadeIn_400ms_ease-out]",
            // Tighter on mobile so the lockup tucks under the
            // 18px wordmark without poking into the hamburger
            // / user menu on small viewports.
            isMobile ? "text-[9px] tracking-[0.18em]" : "text-[10px] tracking-[0.22em]",
          ].join(" ")}
          aria-hidden="true"
        >
          Drive Your Market
        </span>
      </span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────
// UserMenu — desktop account dropdown. Trigger button + Card-
// styled menu sheet. data-user-menu on both elements so the
// click-outside handler in <Navbar> can scope dismissal.
// ─────────────────────────────────────────────────────────────────

function UserMenu({
  open,
  onToggle,
  onItemClick,
  onLogout,
  label,
  activePath,
}: {
  open: boolean;
  onToggle: () => void;
  onItemClick: () => void;
  onLogout: () => void;
  label: string;
  activePath: string;
}) {
  return (
    <div data-user-menu className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-default bg-surface-card px-3.5 text-sm font-medium text-primary transition-colors hover:border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
      >
        <span className="max-w-[200px] truncate">{label}</span>
        <ChevronDown
          className={[
            "h-4 w-4 text-secondary transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          data-user-menu
          className="absolute right-0 top-[calc(100%+8px)] min-w-[220px]"
        >
          <Card variant="elevated" padding="sm" role="menu">
            {USER_LINKS.map((item) => {
              const active = activePath === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onItemClick}
                  role="menuitem"
                  className={[
                    "block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-teal-soft text-brand-navy"
                      : "text-primary hover:bg-surface-muted",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
            <div
              className="my-1 h-px bg-default"
              style={{ backgroundColor: "var(--border-default)" }}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={onLogout}
              role="menuitem"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-state-live transition-colors hover:bg-[var(--state-live)]/10"
            >
              Sign out
            </button>
          </Card>
        </div>
      )}
    </div>
  );
}
