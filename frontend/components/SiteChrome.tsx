"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { DumPill } from "./DumPill";
import { LiveActivityTicker } from "./LiveActivityTicker";
import { SiteFooter } from "./SiteFooter";
import { FloatingGoLive } from "./FloatingGoLive";
import { BottomTabNav } from "./BottomTabNav";

const commitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "";
// VERCEL_ENV / NEXT_PUBLIC_VERCEL_ENV: only the NEXT_PUBLIC_-prefixed form
// is reliably inlined into the client bundle by Next.js's DefinePlugin.
// The bare VERCEL_ENV reads as undefined on the client (it's a server-only
// var by default), which previously caused the deploy badge to render
// inconsistently between SSR and hydration → React hydration error #418
// firing on every page. Read the public-prefixed var, fall back to the
// bare one for server contexts.
const vercelEnv =
  process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || "";
const isPreview = vercelEnv === "preview";

// Path prefixes that opt out of the SiteFooter even though they keep
// the rest of the chrome (navbar, ticker, points pill). Embed routes
// are already handled by the isEmbed early-return below — these are
// pages where a marketing footer would distract from the task at
// hand or, in the case of /project/[id]/{manage,book}, conflict with
// the in-page workflow chrome.
//
// Public storefronts at /project/[id] keep the footer; only the
// owner-only /manage surface and the buyer /book checkout flow
// strip it.
const FOOTER_EXCLUDED_PREFIXES = [
  "/dashboard",
  "/admin",
  "/auth",
  "/_dev",
  "/verify/",
];
const FOOTER_EXCLUDED_EXACT = new Set<string>([
  "/merchant/stripe-callback",
]);
const FOOTER_EXCLUDED_REGEXES = [
  /^\/project\/[^/]+\/(manage|book)(?:\/|$)/,
];

function shouldHideFooter(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (FOOTER_EXCLUDED_EXACT.has(pathname)) return true;
  for (const prefix of FOOTER_EXCLUDED_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  for (const re of FOOTER_EXCLUDED_REGEXES) {
    if (re.test(pathname)) return true;
  }
  return false;
}

/**
 * Wraps page content with the global DUM Club chrome (navbar, ticker,
 * DUM Points pill, deploy indicator, marketing footer) on every route
 * EXCEPT the embed routes.
 *
 * The /embed/[businessId] surface is loaded inside merchant websites
 * via iframe and must present zero DUM Club chrome — no nav, no
 * ticker, no points pill, no deploy badge, no footer. Anything that
 * screams "you're on dum.club" breaks the merchant's experience.
 *
 * The SiteFooter is mounted here too so every public marketing /
 * informational page (home, discover, merchant, pricing, about,
 * technology, investors, terms, privacy, hub, leaderboard, etc.)
 * gets the same canonical footer without each page rendering its
 * own copy. A small exclusion list strips it from dashboards,
 * admin tooling, auth callbacks, the verify-code surface, the
 * Stripe Connect callback, and the per-project /manage and /book
 * flows — surfaces where a marketing footer would distract from
 * the task at hand.
 *
 * Implementation: client component, gates on `usePathname()`. The
 * root layout still wraps everything in HTML/body and the providers
 * tree (Privy, wallets, AuthContext); only the visible chrome is
 * suppressed for embed routes.
 *
 * Why not a route group (app/(site)/...) — that's the canonical
 * Next.js pattern but requires moving every existing page folder
 * into a (site)/ group. This single-file gate keeps the change
 * surgical for MVP. Revisit when we have more parallel chrome
 * variants.
 */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isEmbed =
    pathname === "/embed" || (pathname?.startsWith("/embed/") ?? false);
  const hideFooter = shouldHideFooter(pathname);

  // Defer the deploy-badge render to post-mount. The badge depends on
  // VERCEL_ENV which is only reliably available on the server, so SSR
  // and client render disagreed about whether to show it — that produced
  // a React hydration error on every page. Gating with `mounted` makes
  // the SSR HTML match the initial client render (both render no badge),
  // and then the badge appears after hydration on non-prod envs.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (isEmbed) {
    // Bare-bones: page content only, no chrome and no spacer.
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      {/* Spacer offsets the fixed navbar — must match the Phase 10
          Navbar's height exactly (h-16 mobile / h-20 desktop). The
          old 72/92 spacer left an 8/12px gap below the header that
          read as a layout bug after the Navbar height shrank. */}
      <div className="h-16 lg:h-20" />
      {/* Live activity ticker — only on /discover. Elsewhere it
          distracts from the task (signup, pricing, reading) and the
          empty/low-volume state reads as a sandbox. The ticker
          already filters to real Stripe sales only. */}
      {pathname === "/discover" && <LiveActivityTicker />}
      {children}
      {!hideFooter && <SiteFooter pathname={pathname} />}
      {/* Mobile app-shell tab bar (Home/Live/+/Bag/You). Self-hides on the
          storefront, embed, and admin/dashboard surfaces; renders a spacer so
          content + footer clear it. Desktop keeps the top navbar. */}
      <BottomTabNav />
      <DumPill />
      <FloatingGoLive />
      {/* Deploy indicator — low-visibility, bottom-right. Hidden in
          production. Gated on `mounted` so SSR + first client paint
          stay identical and React hydration doesn't disagree about
          whether to render it. Tokenised to brand-teal (default,
          dev/unset env) or amber-500 (preview) per Phase 10. */}
      {mounted && commitSha && vercelEnv !== "production" && (
        <div
          className="fixed bottom-2 right-2 z-[60] flex items-center gap-1.5 rounded-md border border-default bg-surface-card/90 px-2 py-1 font-mono text-[9px] text-secondary backdrop-blur-sm"
          title={`Deploy: ${commitSha}${isPreview ? " (preview)" : ""}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isPreview ? "bg-amber-500" : "bg-brand-teal"
            }`}
          />
          {commitSha.slice(0, 7)}
          {isPreview && <span className="text-amber-500">preview</span>}
        </div>
      )}
    </>
  );
}
