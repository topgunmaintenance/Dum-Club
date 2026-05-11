"use client";

/**
 * PopInSellerHost — orchestrates the DUM Pop-In Seller bubble.
 *
 * Owns:
 *   - trigger rules (5s dwell + returning-visitor detection)
 *   - dismiss persistence (localStorage, per-project, 24h TTL)
 *   - greeting selection (first-visit vs returning, personalized
 *     with the merchant's display name)
 *   - analytics event firing (popin_view / popin_click /
 *     popin_dismiss / popin_offer_click)
 *
 * MVP scope per audit decision: Mode C only (static greeting + offer
 * chip, no video, no live IVS subscription). The bubble renders only
 * when a pinned offer exists on the merchant's storefront.
 *
 * Returning-visitor detection reuses the localStorage `dum_visitor_id`
 * key written by lib/analytics.ts on first event fire. If the key
 * already existed when this host mounts, the visitor is returning;
 * if it's freshly minted by analytics during the same load, they're
 * new. This is best-effort — falls open to "first visit" when storage
 * is blocked (sandboxed iframe), which is the friendlier default.
 *
 * No new server-side state. No tier gate. The bubble shows for every
 * merchant per the MVP scoping decision.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { trackEvent } from "../lib/analytics";
import { PopInSeller, type PopInOffer } from "./PopInSeller";

type PopInSellerHostProps = {
  projectId: string | null | undefined;
  merchantName: string;
  avatarUrl?: string | null;
  pinnedOffer: PopInOffer | null;
  /** Called when the visitor clicks the offer chip — typically wired
   *  to scroll to / focus the embed's main buy panel. */
  onOfferClick: () => void;
};

// 5-second dwell before showing. Spec: "show after 5 seconds."
const FIRST_VISIT_DELAY_MS = 5000;

// Returning visitors see the bubble sooner — they've already gotten
// past the "is this a real site" question.
const RETURNING_VISITOR_DELAY_MS = 1500;

// Dismiss TTL — once dismissed, the bubble stays hidden on this
// project for 24h. Long enough not to annoy in a single session,
// short enough to retry if a customer comes back next day.
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

const VISITOR_KEY = "dum_visitor_id";
const dismissedKey = (projectId: string) => `dum_popin_dismissed_${projectId}`;

function wasVisitorKnownAtMount(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(VISITOR_KEY));
  } catch {
    return false;
  }
}

function readDismissedAt(projectId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(dismissedKey(projectId));
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeDismissedAt(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dismissedKey(projectId), String(Date.now()));
  } catch {
    /* storage blocked — re-shows on next load, acceptable */
  }
}

export function PopInSellerHost({
  projectId,
  merchantName,
  avatarUrl,
  pinnedOffer,
  onOfferClick,
}: PopInSellerHostProps) {
  // Captured once on first render — analytics writes the visitor id
  // when its first event fires (e.g. embed_view on the page mount),
  // which can race with this hook's mount. We sample what was in
  // storage BEFORE the page settled, which is the correct
  // returning-visitor signal.
  const [isReturning] = useState(wasVisitorKnownAtMount);

  // Visible-now state. Starts false; becomes true after the dwell
  // timer (or returning-visitor early-show). Goes back to false on
  // dismiss + persists the dismiss across reload.
  const [visible, setVisible] = useState(false);

  // Suppress entirely if the user dismissed within the TTL window.
  // We check on mount only; a longer-lived session won't recheck.
  const [suppressed, setSuppressed] = useState(() => {
    if (!projectId) return true; // no project → no bubble
    const at = readDismissedAt(projectId);
    return at > 0 && Date.now() - at < DISMISS_TTL_MS;
  });

  // First-visit vs returning greeting. Personalized with the
  // merchant's display name per the MVP scoping decision.
  const greeting = useMemo(() => {
    const name = (merchantName || "").trim() || "this business";
    return isReturning
      ? `Welcome back to ${name}. Today's featured offer is below.`
      : `Welcome to ${name}. Today's featured offer is below.`;
  }, [merchantName, isReturning]);

  // Dwell timer → show. No bubble until we have a project id AND a
  // pinned offer AND the user hasn't dismissed in the last 24h.
  useEffect(() => {
    if (suppressed) return;
    if (!projectId) return;
    if (!pinnedOffer) return;
    if (visible) return;

    const delay = isReturning ? RETURNING_VISITOR_DELAY_MS : FIRST_VISIT_DELAY_MS;
    const t = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(t);
  }, [suppressed, projectId, pinnedOffer, isReturning, visible]);

  // Fire popin_view once, the first time the bubble actually shows.
  // Guarded by `visible` so the trigger conditions can change without
  // re-firing.
  useEffect(() => {
    if (!visible || !projectId) return;
    trackEvent("popin_view", {
      project_id: projectId,
      offer_id: pinnedOffer?.id ?? null,
      metadata: { trigger: isReturning ? "returning_visitor" : "dwell_5s" },
    });
    // We intentionally don't include pinnedOffer in deps — the view
    // event represents the bubble appearing, not the offer changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleDismiss = useCallback(() => {
    if (projectId) {
      writeDismissedAt(projectId);
      trackEvent("popin_dismiss", { project_id: projectId });
    }
    setSuppressed(true);
    setVisible(false);
  }, [projectId]);

  const handleOfferClick = useCallback(() => {
    if (projectId) {
      trackEvent("popin_offer_click", {
        project_id: projectId,
        offer_id: pinnedOffer?.id ?? null,
      });
      // Generic popin_click — useful when we add more click affordances
      // (e.g. avatar tap, expand, video play). Keeps the funnel summary
      // honest even if we mis-classify a specific click later.
      trackEvent("popin_click", {
        project_id: projectId,
        offer_id: pinnedOffer?.id ?? null,
        metadata: { target: "offer" },
      });
    }
    onOfferClick();
  }, [projectId, pinnedOffer?.id, onOfferClick]);

  if (!visible || !projectId || !pinnedOffer) return null;

  return (
    <PopInSeller
      greeting={greeting}
      merchantName={merchantName}
      avatarUrl={avatarUrl ?? null}
      offer={pinnedOffer}
      onOfferClick={handleOfferClick}
      onDismiss={handleDismiss}
    />
  );
}
