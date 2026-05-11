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

/**
 * Merchant-configurable Pop-In settings. Lives on projects.popin_config
 * as JSONB. All fields optional — empty object means "use defaults"
 * (the PR #133 MVP behaviour). Forward-declared modes (recorded /
 * live / auto) are accepted in the type union but the backend rejects
 * non-"bubble" writes until those features ship.
 */
export type PopInConfig = {
  enabled?: boolean;
  greeting?: string;
  returning_greeting?: string;
  delay_seconds?: number;
  once_per_session?: boolean;
  offer_id?: string | null;
  mode?: "bubble" | "recorded" | "live" | "auto";
  /** Mode B (recorded video). Plain http(s) URL — sanitized by the
   *  backend on write. Falls back to bubble mode silently if missing
   *  even when mode === "recorded". */
  video_url?: string | null;
};

type PopInSellerHostProps = {
  projectId: string | null | undefined;
  merchantName: string;
  avatarUrl?: string | null;
  pinnedOffer: PopInOffer | null;
  /** Optional merchant-configured overrides loaded from
   *  projects.popin_config. Missing or empty → falls back to defaults
   *  that match the PR #133 MVP. */
  config?: PopInConfig | null;
  /** Lookup so the offer-override (config.offer_id) can resolve to a
   *  rich PopInOffer. If the override resolves to nothing, we fall
   *  back to the pinnedOffer prop. */
  resolveOffer?: (offerId: string) => PopInOffer | null;
  /** Called when the visitor clicks the offer chip — typically wired
   *  to scroll to / focus the embed's main buy panel. */
  onOfferClick: () => void;
};

// Default dwell on first visit. Spec MVP: "show after 5 seconds."
// Merchant can override via popin_config.delay_seconds.
const DEFAULT_FIRST_VISIT_DELAY_S = 5;

// Returning visitors see the bubble sooner — they've already gotten
// past the "is this a real site" question. Not merchant-tunable
// today; can be a future field.
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

// localStorage key for once-per-session suppression. The "session"
// here = browser tab session. Cleared automatically on tab close;
// distinct from the 24h dismiss key so they don't fight.
const SESSION_SHOWN_KEY = (projectId: string) => `dum_popin_shown_session_${projectId}`;

function wasShownThisSession(projectId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_SHOWN_KEY(projectId)) === "1";
  } catch {
    return false;
  }
}

function markShownThisSession(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_SHOWN_KEY(projectId), "1");
  } catch {
    /* sessionStorage blocked — falls open to "always show" */
  }
}

export function PopInSellerHost({
  projectId,
  merchantName,
  avatarUrl,
  pinnedOffer,
  config,
  resolveOffer,
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

  // Merchant-config resolution. Empty / missing config → all defaults.
  const cfg = config ?? {};
  const enabled = cfg.enabled !== false; // default true
  const delaySeconds =
    typeof cfg.delay_seconds === "number" && Number.isFinite(cfg.delay_seconds)
      ? Math.max(0, Math.min(60, cfg.delay_seconds))
      : DEFAULT_FIRST_VISIT_DELAY_S;
  const oncePerSession = cfg.once_per_session === true;

  // Mode resolution. "bubble" is the always-on default. "recorded"
  // requires a non-empty video_url; otherwise we fall back to
  // bubble so the visitor never sees a broken / empty video tile.
  // "live" and "auto" are forward-declared and treated as bubble
  // for now (their dedicated PRs flip this).
  const rawMode = cfg.mode ?? "bubble";
  const videoUrl =
    typeof cfg.video_url === "string" && cfg.video_url.trim()
      ? cfg.video_url.trim()
      : null;
  const activeMode: "bubble" | "recorded" =
    rawMode === "recorded" && videoUrl ? "recorded" : "bubble";

  // Suppress entirely if:
  //   - merchant disabled it, OR
  //   - no project id, OR
  //   - merchant flipped on once-per-session AND we already showed it
  //     in this browser tab, OR
  //   - user dismissed within the 24h TTL window
  const [suppressed, setSuppressed] = useState(() => {
    if (!enabled) return true;
    if (!projectId) return true;
    if (oncePerSession && wasShownThisSession(projectId)) return true;
    const at = readDismissedAt(projectId);
    return at > 0 && Date.now() - at < DISMISS_TTL_MS;
  });

  // Offer resolution: merchant-overridden offer wins over pinned
  // offer. resolveOffer is provided by the embed so we don't re-fetch
  // offers in the host (the embed already has them in memory).
  const offer: PopInOffer | null = useMemo(() => {
    if (cfg.offer_id && resolveOffer) {
      const override = resolveOffer(cfg.offer_id);
      if (override) return override;
    }
    return pinnedOffer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.offer_id, pinnedOffer?.id, resolveOffer]);

  // First-visit vs returning greeting. Merchant-supplied overrides
  // beat the personalized default. Defaults still inject the merchant
  // display name so a brand-new merchant gets sensible copy without
  // touching any settings.
  const greeting = useMemo(() => {
    const name = (merchantName || "").trim() || "this business";
    if (isReturning) {
      return (
        cfg.returning_greeting?.trim() ||
        `Welcome back to ${name}. Today's featured offer is below.`
      );
    }
    return (
      cfg.greeting?.trim() ||
      `Welcome to ${name}. Today's featured offer is below.`
    );
  }, [merchantName, isReturning, cfg.greeting, cfg.returning_greeting]);

  // Dwell timer → show. No bubble until we have a project id AND an
  // offer (pinned or overridden) AND not suppressed. activeMode is
  // either "bubble" or "recorded" by this point — both render the
  // bubble; recorded just swaps the avatar for a video tile.
  useEffect(() => {
    if (suppressed) return;
    if (!projectId) return;
    if (!offer) return;
    if (visible) return;

    const delay = isReturning
      ? RETURNING_VISITOR_DELAY_MS
      : delaySeconds * 1000;
    const t = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(t);
  }, [suppressed, projectId, offer, isReturning, visible, delaySeconds, activeMode]);

  // Fire popin_view once, the first time the bubble actually shows.
  // Also writes the session-shown flag if oncePerSession is on so the
  // bubble stays hidden for the rest of the tab session.
  useEffect(() => {
    if (!visible || !projectId) return;
    if (oncePerSession) markShownThisSession(projectId);
    trackEvent("popin_view", {
      project_id: projectId,
      offer_id: offer?.id ?? null,
      metadata: {
        trigger: isReturning ? "returning_visitor" : "dwell",
        delay_s: isReturning ? RETURNING_VISITOR_DELAY_MS / 1000 : delaySeconds,
        once_per_session: oncePerSession,
        mode: activeMode,
      },
    });
    // We intentionally don't include offer in deps — the view event
    // represents the bubble appearing, not the offer changing.
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
        offer_id: offer?.id ?? null,
      });
      // Generic popin_click — useful when we add more click affordances
      // (e.g. avatar tap, expand, video play). Keeps the funnel summary
      // honest even if we mis-classify a specific click later.
      trackEvent("popin_click", {
        project_id: projectId,
        offer_id: offer?.id ?? null,
        metadata: { target: "offer" },
      });
    }
    onOfferClick();
  }, [projectId, offer?.id, onOfferClick]);

  // Video analytics callbacks. The video tile renders inside
  // PopInSeller; the host owns event firing so projectId/offer
  // context stays here.
  const handleVideoVisible = useCallback(() => {
    if (!projectId) return;
    trackEvent("popin_video_view", {
      project_id: projectId,
      offer_id: offer?.id ?? null,
      metadata: { mode: activeMode },
    });
  }, [projectId, offer?.id, activeMode]);

  const handleVideoPlay = useCallback(() => {
    if (!projectId) return;
    trackEvent("popin_video_play", {
      project_id: projectId,
      offer_id: offer?.id ?? null,
    });
  }, [projectId, offer?.id]);

  const handleVideoClick = useCallback(() => {
    if (!projectId) return;
    trackEvent("popin_video_click", {
      project_id: projectId,
      offer_id: offer?.id ?? null,
    });
  }, [projectId, offer?.id]);

  if (!visible || !projectId || !offer) return null;

  return (
    <PopInSeller
      greeting={greeting}
      merchantName={merchantName}
      avatarUrl={avatarUrl ?? null}
      offer={offer}
      onOfferClick={handleOfferClick}
      onDismiss={handleDismiss}
      videoUrl={activeMode === "recorded" ? videoUrl : null}
      onVideoVisible={handleVideoVisible}
      onVideoPlay={handleVideoPlay}
      onVideoClick={handleVideoClick}
    />
  );
}
