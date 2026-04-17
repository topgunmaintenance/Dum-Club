/**
 * automation.ts — Event capture and follow-up trigger hooks.
 *
 * Phase 0 structure layer. Captures business interaction events
 * (inquiry, click, booking, purchase) and stores them via the
 * backend API. Provides a placeholder trigger for follow-up
 * actions (auto-reply, retention nudge, etc.) that will be
 * wired up in later phases.
 *
 * Rules (from task file):
 * - No full AI build yet
 * - No external APIs (only our own backend)
 * - Structure only — capture → store → trigger placeholder
 */

import { API_BASE } from "./apiBase";

/* ─── Event Types ─── */

export type AutomationEventType =
  | "inquiry"      // customer sent a message via AI chat
  | "click"        // customer clicked a service/offer
  | "booking"      // customer initiated a booking
  | "purchase"     // customer completed a Stripe checkout
  | "page_view"    // customer viewed a storefront
  | "follow_up";   // system-generated follow-up (future)

export interface AutomationEvent {
  type: AutomationEventType;
  project_id: string;
  /** Privy user ID if authenticated, null if anonymous */
  user_id?: string | null;
  /** Freeform metadata — offer name, message text, amount, etc. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp — set automatically if omitted */
  timestamp?: string;
}

/* ─── Capture (fire-and-forget) ─── */

/**
 * Sends an automation event to the backend for storage.
 * Fire-and-forget: never blocks UI, never throws.
 *
 * Backend endpoint: POST /api/automation/events
 * (will return 404 until the backend route is created —
 *  that's fine, the frontend is ready before the backend)
 */
export function captureEvent(event: AutomationEvent): void {
  const payload = {
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  // Fire-and-forget — don't await, don't block, don't throw
  fetch(`${API_BASE}/api/automation/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silently fail — automation capture should never break UX
  });
}

/* ─── Follow-up Trigger (placeholder) ─── */

/**
 * Placeholder for the follow-up engine. In later phases this will:
 * - Queue auto-reply emails after inquiry events
 * - Send DUM Points reminders after purchases
 * - Trigger retention nudges for inactive customers
 * - Fire AI social media posts for deal events
 *
 * For now it just logs to console in development.
 */
export function triggerFollowUp(event: AutomationEvent): void {
  if (process.env.NODE_ENV === "development") {
    console.log("[automation] follow-up trigger:", event.type, event.metadata);
  }

  // Phase 2+: call backend follow-up queue
  // fetch(`${API_BASE}/api/automation/follow-up`, { ... })
}

/* ─── Convenience helpers ─── */

/** Capture an inquiry (AI chat message from a customer) */
export function captureInquiry(
  projectId: string,
  message: string,
  userId?: string | null,
): void {
  const event: AutomationEvent = {
    type: "inquiry",
    project_id: projectId,
    user_id: userId,
    metadata: { message: message.slice(0, 500) }, // cap for safety
  };
  captureEvent(event);
  triggerFollowUp(event);
}

/** Capture a service/offer click */
export function captureOfferClick(
  projectId: string,
  offerName: string,
  priceUsd?: number,
  userId?: string | null,
): void {
  captureEvent({
    type: "click",
    project_id: projectId,
    user_id: userId,
    metadata: { offer_name: offerName, price_usd: priceUsd },
  });
}

/** Capture a completed purchase */
export function capturePurchase(
  projectId: string,
  offerName: string,
  amountUsd: number,
  orderId?: string,
  userId?: string | null,
): void {
  const event: AutomationEvent = {
    type: "purchase",
    project_id: projectId,
    user_id: userId,
    metadata: { offer_name: offerName, amount_usd: amountUsd, order_id: orderId },
  };
  captureEvent(event);
  triggerFollowUp(event);
}

/** Capture a booking initiation */
export function captureBooking(
  projectId: string,
  serviceName: string,
  userId?: string | null,
): void {
  const event: AutomationEvent = {
    type: "booking",
    project_id: projectId,
    user_id: userId,
    metadata: { service_name: serviceName },
  };
  captureEvent(event);
  triggerFollowUp(event);
}
