/**
 * lib/offers — typed helpers around the offers API.
 *
 * Centralises three things that were inlined into multiple call
 * sites and surfaced as opaque "TypeError: Failed to fetch" toasts:
 *
 *   1. Bearer token validation (no Authorization: Bearer undefined).
 *   2. URL construction (uses lib/apiBase, never relative paths).
 *   3. Error classification — request never started (TypeError),
 *      HTTP error response (4xx/5xx), or auth-not-ready — so the
 *      UI can show a useful message instead of "Failed to fetch".
 *
 * Pure module; no React. Unit-testable from node --test (see
 * frontend/__tests__/lib/offers.test.ts).
 */

import { API_BASE, isApiBaseConfigured } from "./apiBase";

/**
 * Normalises a raw token value to a clean Bearer-safe string.
 *
 *   null / undefined / "" / whitespace          -> null
 *   contains CR/LF or other header-unsafe bytes -> null
 *   otherwise                                   -> trimmed token
 *
 * The Privy JWT format is `header.payload.signature` (three
 * base64-url segments) so a legitimate token always passes.
 */
export function sanitizeBearerToken(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // RFC 7230 §3.2.6: header value is ASCII visible (0x21-0x7E) +
  // SP / HTAB. We reject anything outside that range so the fetch
  // implementation never throws synchronously on a malformed
  // Authorization header.
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c === 0x20 || c === 0x09) continue; // SP / HTAB
    if (c < 0x21 || c > 0x7e) return null;
  }
  return trimmed;
}

/**
 * Error code surfaced by createOffer / updateOffer. Lets the call
 * site pick the right user-facing copy without inspecting the
 * underlying Error class.
 *
 *   "no_token"          token missing / unusable; user not signed in
 *   "no_api_base"       NEXT_PUBLIC_API_URL missing on the deploy
 *   "request_not_sent"  fetch threw before the request left the tab
 *                       (mixed-content, DNS, malformed URL, etc.)
 *   "http_error"        request returned non-2xx; server message
 *                       attached
 *   "network_error"     request started but failed mid-flight
 */
export type OffersErrorCode =
  | "no_token"
  | "no_api_base"
  | "request_not_sent"
  | "http_error"
  | "network_error";

export class OffersError extends Error {
  code: OffersErrorCode;
  status?: number;
  constructor(code: OffersErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type OfferPayload = {
  project_id?: string;
  title: string;
  description?: string | null;
  price_usd: number;
  offer_type?: string;
  delivery_info?: string | null;
  token_discount_percent?: number;
  primary_image_url?: string | null;
  video_url?: string | null;
  quantity_available?: number | null;
  unlimited_inventory?: boolean;
  // Canonical category from the seeded categories table (mig 035).
  // Optional: existing callers that don't supply it preserve their
  // current behavior (NULL on create; field dropped on update).
  category_id?: string | null;
};

type RequestOpts = {
  token: string | null | undefined;
  body: Partial<OfferPayload>;
  /** Optional fetch implementation — passed by tests. Defaults to
   *  the global window fetch. */
  fetchImpl?: typeof fetch;
};

async function doRequest(
  url: string,
  method: "POST" | "PATCH",
  { token, body, fetchImpl }: RequestOpts,
): Promise<unknown> {
  const cleanToken = sanitizeBearerToken(token);
  if (!cleanToken) {
    throw new OffersError("no_token", "Please sign in to create an offer.");
  }
  if (!isApiBaseConfigured()) {
    throw new OffersError(
      "no_api_base",
      "The backend URL is not configured for this site. Refresh the page; if this persists, contact support.",
    );
  }

  const fetchFn = fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchFn) {
    throw new OffersError(
      "request_not_sent",
      "Could not start request. Please refresh and try again.",
    );
  }

  // Safe debug log: never logs the token, only its presence/shape.
  if (typeof console !== "undefined" && typeof window !== "undefined") {
    try {
      const bodyStr = JSON.stringify(body);
      console.debug("[offers] request", {
        url,
        method,
        token_present: true,
        token_shape_ok: true,
        body_bytes: bodyStr.length,
      });
    } catch {
      /* logging is best-effort */
    }
  }

  let res: Response;
  try {
    res = await fetchFn(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanToken}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // fetch() rejects with TypeError when:
    //   - the request was blocked (mixed content, CORS preflight,
    //     CSP),
    //   - the URL was malformed,
    //   - the network layer never received bytes.
    // Distinguish from a legitimate HTTP error below.
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof TypeError) {
      throw new OffersError(
        "request_not_sent",
        `Could not start request. Please refresh and sign in again. (${msg})`,
      );
    }
    throw new OffersError(
      "network_error",
      `Network error. Check your connection and try again. (${msg})`,
    );
  }

  if (!res.ok) {
    let detail = `Request failed (HTTP ${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") {
        detail = data.detail;
      } else if (Array.isArray(data?.detail)) {
        detail = data.detail
          .map((e: unknown) =>
            e && typeof e === "object" && "msg" in e
              ? String((e as { msg?: unknown }).msg)
              : JSON.stringify(e),
          )
          .join("; ");
      }
    } catch {
      /* response had no JSON body */
    }
    throw new OffersError("http_error", detail, res.status);
  }

  // Some PATCH endpoints return 204 No Content; guard the JSON parse.
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** POST /api/offers/create */
export function createOffer(
  opts: RequestOpts & { body: OfferPayload & { project_id: string } },
): Promise<unknown> {
  return doRequest(`${API_BASE}/api/offers/create`, "POST", opts);
}

/** PATCH /api/offers/{id} */
export function updateOffer(
  opts: RequestOpts & { offerId: string; body: Partial<OfferPayload> },
): Promise<unknown> {
  return doRequest(`${API_BASE}/api/offers/${opts.offerId}`, "PATCH", opts);
}
