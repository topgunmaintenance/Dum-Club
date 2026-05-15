/**
 * lib/apiBase — single source of truth for the backend API URL.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_API_URL (build-time env, inlined into the client
 *      bundle by Next.js).
 *   2. http://localhost:8000 for SSR / local dev when the env is
 *      not set (NODE_ENV !== 'production').
 *
 * Production builds (NODE_ENV === 'production') hard-fail at module
 * load when NEXT_PUBLIC_API_URL is missing. A silent same-origin or
 * localhost fallback in production has bitten this codebase before
 * (ROADMAP non-blocking item — apiBase.ts:8) — a teammate redeploys
 * without the env set, the bundle ships with an empty API base, and
 * every signed-in flow breaks at the first fetch. Better to refuse
 * to render than to ship a broken frontend.
 *
 * Also upgrades http:// -> https:// at runtime when the page itself
 * is https. Cross-protocol (mixed-content) fetches are blocked by
 * the browser before they leave the tab.
 */

const RAW_ENV = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
const IS_PROD_BUILD = process.env.NODE_ENV === "production";

function resolveApiBase(): string {
  if (!RAW_ENV) {
    if (IS_PROD_BUILD) {
      throw new Error(
        "[apiBase] NEXT_PUBLIC_API_URL is not set on this production build. " +
          "Set the env on the Vercel project and redeploy. Refusing to render " +
          "with an empty API base — silent fallbacks broke production before.",
      );
    }
    // Local dev / SSR without the env set.
    return "http://localhost:8000";
  }

  // Browser path — auto-upgrade http -> https on https pages unless
  // the target is localhost / 127.0.0.1 (dev only).
  if (typeof window !== "undefined") {
    const onHttps = window.location.protocol === "https:";
    if (
      onHttps &&
      RAW_ENV.startsWith("http://") &&
      !/\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(RAW_ENV)
    ) {
      return RAW_ENV.replace(/^http:\/\//, "https://");
    }
  }

  return RAW_ENV;
}

export const API_BASE = resolveApiBase();

/**
 * True when API_BASE is a real, reachable origin for the current
 * page. Callers that want to fail fast on a misconfigured deploy
 * can gate their network calls on this rather than catching
 * `TypeError: Failed to fetch` deep inside their submit handler.
 *
 * In production this is always true — the module would have thrown
 * at load time if the env were missing. Kept for parity with the
 * dev path where localhost-on-https would still be unreachable.
 */
export function isApiBaseConfigured(): boolean {
  if (!RAW_ENV) return false;
  if (typeof window !== "undefined") {
    if (
      window.location.protocol === "https:" &&
      /\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(RAW_ENV)
    ) {
      return false;
    }
  }
  return true;
}
