"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "./Navbar";
import { DumPill } from "./DumPill";
import { LiveActivityTicker } from "./LiveActivityTicker";

const commitSha = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "";
const isPreview = process.env.VERCEL_ENV === "preview";

/**
 * Wraps page content with the global DUM Club chrome (navbar, ticker,
 * DUM Points pill, deploy indicator) on every route EXCEPT the embed
 * routes.
 *
 * The /embed/[businessId] surface is loaded inside merchant websites
 * via iframe and must present zero DUM Club chrome — no nav, no
 * ticker, no points pill, no deploy badge. Anything that screams
 * "you're on dum.club" breaks the merchant's experience.
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

  if (isEmbed) {
    // Bare-bones: page content only, no chrome and no spacer.
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      {/* Spacer to offset fixed navbar: 72px mobile, 92px desktop */}
      <div className="h-[72px] lg:h-[92px]" />
      {/* Global live activity ticker — sits directly below the navbar. */}
      <LiveActivityTicker />
      {children}
      <DumPill />
      {/* Deploy indicator — low-visibility, bottom-right */}
      {commitSha && (
        <div
          className="fixed bottom-2 right-2 z-[9999] flex items-center gap-1.5 rounded-md bg-zinc-950/80 px-2 py-1 font-mono text-[9px] text-zinc-700 backdrop-blur-sm"
          title={`Deploy: ${commitSha}${isPreview ? " (preview)" : ""}`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isPreview ? "bg-amber-500" : "bg-emerald-500/60"
            }`}
          />
          {commitSha.slice(0, 7)}
          {isPreview && <span className="text-amber-500">preview</span>}
        </div>
      )}
    </>
  );
}
