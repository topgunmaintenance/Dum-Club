/**
 * Drive Your Market Analytics — client tracker.
 *
 * Fire-and-forget event sender. Never throws, never blocks, never
 * awaits. Uses navigator.sendBeacon when available (the right tool
 * for "ping the server right before the page navigates away" — e.g.
 * the checkout_start handoff to Stripe), with a fetch-with-keepalive
 * fallback for older browsers or non-beacon contexts.
 *
 * Privacy:
 *   - anonymous_visitor_id is a client-side UUIDv4 cached in
 *     localStorage under DUM_VISITOR_KEY. Falls back to a one-shot
 *     per-session UUID if storage is blocked (e.g. sandboxed iframe
 *     with no storage access). No IP, no fingerprint, no precise
 *     location collected by the client.
 *   - session_id is a separate UUID per browser tab session
 *     (re-generated every time the module loads).
 *   - Cross-origin iframe consequence: localStorage is partitioned
 *     per merchant origin, which is correct for "did this merchant
 *     get a repeat visitor on their own embed." We do not attempt
 *     cross-merchant identity tracking.
 */

import { API_BASE } from "./apiBase";

export type AnalyticsEventType =
  | "embed_view"
  | "project_view"
  | "offer_view"
  | "checkout_start"
  | "purchase_completed"
  | "live_view"
  | "return_visit";

type EventPayload = {
  project_id?: string | null;
  offer_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

const DUM_VISITOR_KEY = "dum_visitor_id";
const ENDPOINT = "/api/analytics/event";

let memoryVisitorId: string | null = null;
let sessionId: string | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  // Lightweight RFC4122 v4 fallback for very old browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getVisitorId(): string {
  if (memoryVisitorId) return memoryVisitorId;
  if (typeof window === "undefined") {
    return ""; // SSR — no client-side tracking
  }
  try {
    const stored = window.localStorage.getItem(DUM_VISITOR_KEY);
    if (stored) {
      memoryVisitorId = stored;
      return stored;
    }
    const fresh = uuid();
    window.localStorage.setItem(DUM_VISITOR_KEY, fresh);
    memoryVisitorId = fresh;
    return fresh;
  } catch {
    // Storage blocked (e.g. sandboxed iframe). Use per-session id only.
    if (!memoryVisitorId) memoryVisitorId = uuid();
    return memoryVisitorId;
  }
}

function getSessionId(): string {
  if (sessionId) return sessionId;
  sessionId = uuid();
  return sessionId;
}

/**
 * Track a single analytics event. Synchronous return; the network
 * request runs asynchronously and any failure is silently swallowed.
 *
 * Safe to call from any client-side render path. Safe to call
 * unconditionally — it short-circuits during SSR.
 */
export function trackEvent(
  event_type: AnalyticsEventType,
  payload: EventPayload = {},
): void {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({
    event_type,
    anonymous_visitor_id: getVisitorId(),
    session_id: getSessionId(),
    project_id: payload.project_id ?? null,
    offer_id: payload.offer_id ?? null,
    metadata: payload.metadata ?? null,
  });

  const url = `${API_BASE}${ENDPOINT}`;

  // sendBeacon is the right primitive for "fire as the page may be
  // navigating away" (e.g. checkout_start before Stripe redirect).
  // Returns false if the user agent rejected the queue, in which
  // case we fall through to fetch().
  try {
    if ("sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon(url, blob);
      if (sent) return;
    }
  } catch {
    /* fall through */
  }

  // Fallback: fetch with keepalive + no error handling.
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* swallow — analytics must never break a page */
  }
}
