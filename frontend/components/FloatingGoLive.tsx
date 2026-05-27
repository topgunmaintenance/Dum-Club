"use client";

/**
 * FloatingGoLive — persistent "🔴 Go Live" pill for signed-in
 * merchants. Mounted globally by SiteChrome, visible on every
 * non-embed route once the merchant has at least one project
 * with at least one active offer. Clicking routes the merchant
 * to their project page (anchored to #project-live-host where
 * the existing IVSStageHost lives — see PR #175's anchor).
 *
 * Gating:
 *
 *   1. Signed-in (authUser non-null) — guests don't broadcast
 *   2. Owns at least one project — fetched via
 *      GET /api/projects/?owner_id={privyId}
 *   3. That project has at least one active offer — fetched via
 *      GET /api/offers/{project_uuid}
 *
 * If any of those checks fail (no projects, no active offers,
 * any fetch error) the button stays hidden so we don't draw a
 * shortcut into an empty broadcast.
 *
 * The check runs once on mount + on auth changes. We don't
 * poll — a merchant who creates their first offer in another
 * tab won't see the button until the next navigation, which is
 * acceptable for the cold-start case.
 *
 * Style is intentionally distinct from the project page's own
 * IVSStageHost CTA so the merchant can clearly see when they're
 * being offered the shortcut vs already at the host page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import { API_BASE } from "../lib/apiBase";

interface ProjectSummary {
  id: string;
  slug?: string | null;
  is_live?: boolean | null;
}

export function FloatingGoLive() {
  const { user, getToken } = useAuth();
  const pathname = usePathname();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [hasOffer, setHasOffer] = useState(false);
  // Stripe verification gate. The backend /api/ivs/create-stage
  // returns 402 for unverified merchants, so advertising a Go Live
  // shortcut for them just routes the merchant into a cryptic
  // error a few seconds later. Hide the button instead — the
  // dashboard's StripeResumeBanner already tells them what's
  // missing, no need to surface a dead-end Go Live entry point.
  const [stripeVerified, setStripeVerified] = useState(false);

  useEffect(() => {
    if (!user?.privyId) {
      setProject(null);
      setHasOffer(false);
      setStripeVerified(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Pick the merchant's first project — most merchants
        // operate one storefront on DUM Club today. If we ever
        // need multi-project picking the floating button can
        // expand to a small selector.
        const projRes = await fetch(
          `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`,
          { method: "GET" },
        );
        if (!projRes.ok) return;
        const projects = (await projRes.json()) as ProjectSummary[];
        if (cancelled) return;
        const first = Array.isArray(projects) && projects.length > 0 ? projects[0] : null;
        if (!first) return;
        setProject(first);

        const offersRes = await fetch(
          `${API_BASE}/api/offers/${encodeURIComponent(first.id)}`,
          { method: "GET" },
        );
        if (!offersRes.ok) return;
        const offers = await offersRes.json();
        if (cancelled) return;
        const anyActive =
          Array.isArray(offers) &&
          offers.some(
            (o: { is_active?: boolean }) => o && o.is_active !== false,
          );
        if (anyActive) setHasOffer(true);

        // Stripe-verified check. /api/merchant/me requires a Privy
        // bearer token. If the token isn't available (very rare
        // post-rehydrate) treat as not-verified and keep the
        // button hidden.
        const token = await getToken().catch(() => null);
        if (!token) return;
        const merchRes = await fetch(`${API_BASE}/api/merchant/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!merchRes.ok) return;
        const merchJson = await merchRes.json();
        if (cancelled) return;
        const status = merchJson?.merchant?.stripe_connect_status;
        if (status === "verified") setStripeVerified(true);
      } catch {
        // Network error → don't render the button; safer to be
        // absent than to advertise an action we can't fulfil.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.privyId, getToken]);

  if (!user?.privyId) return null;
  if (!project) return null;
  if (!hasOffer) return null;
  if (!stripeVerified) return null;

  // Hide the floating pill on the merchant's own project pages — the
  // AdminBar already renders a Go Live action there, so the floating
  // pill is redundant overlap. Keep it on /dashboard, /discover, etc.
  if (pathname && pathname.startsWith("/project/")) return null;

  const target = `/project/${project.slug || project.id}#project-live-host`;
  const isLive = !!project.is_live;

  return (
    <Link
      href={target}
      data-dum-floating-go-live
      aria-label={isLive ? "Go to your live broadcast" : "Open your project to go live"}
      className="fixed bottom-5 left-5 z-[55] inline-flex items-center gap-2 rounded-full bg-red-500 px-4 py-2.5 text-sm font-bold uppercase tracking-[0.06em] text-white shadow-[0_14px_32px_rgba(239,68,68,0.35),0_0_0_4px_rgba(239,68,68,0.18)] transition hover:translate-y-[-1px] hover:bg-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:bottom-6 sm:left-6"
    >
      <span className="relative inline-flex h-2.5 w-2.5">
        {/* Pulse only when actually streaming — the previous version
            animate-pinged regardless of state, reading as
            "you're live" even when the merchant wasn't broadcasting. */}
        {isLive && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
        )}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      {isLive ? "Live now" : "Go Live"}
    </Link>
  );
}
