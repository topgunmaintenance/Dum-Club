/**
 * lib/apiBase — single source of truth for the backend API URL.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_API_URL (build-time env, inlined into the client
 *      bundle by Next.js).
 *   2. If that env is missing AND we are running in a production
 *      browser context (https origin), fall back to the page's own
 *      origin. That at least gives us deterministic 4xx/5xx errors
 *      we can debug instead of a mixed-content "TypeError: Failed
 *      to fetch" when the build silently fell back to localhost.
 *   3. http://localhost:8000 for SSR / local dev.
 *
 * Also upgrades http:// -> https:// at runtime when the page itself
 * is https. Cross-protocol (mixed-content) fetches are blocked by
 * the browser before they leave the tab, which surfaces in the
 * console as the same opaque "TypeError: Failed to fetch" that
 * triggered this hardening pass.
 */

const RAW_ENV = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");

function resolveApiBase(): string {
  // Browser path
  if (typeof window !== "undefined") {
    const onHttps = window.location.protocol === "https:";

    // Env missing entirely. Don't silently fall through to
    // localhost on a production page — that produces a mixed-
    // content block and a confusing TypeError. Same-origin
    // fallback returns predictable HTTP errors instead.
    if (!RAW_ENV) {
      if (onHttps) {
        if (typeof console !== "undefined") {
          console.error(
            "[apiBase] NEXT_PUBLIC_API_URL is not set on the deployed build. " +
              "Falling back to window.location.origin. Set the env on the " +
              "Vercel project and redeploy to point the client at the real " +
              "backend.",
          );
        }
        return window.location.origin;
      }
      return "http://localhost:8000";
    }

    // Env set but http on an https page. Upgrade unless it's
    // localhost / 127.0.0.1 where http is normal during dev.
    if (
      onHttps &&
      RAW_ENV.startsWith("http://") &&
      !/\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(RAW_ENV)
    ) {
      return RAW_ENV.replace(/^http:\/\//, "https://");
    }

    return RAW_ENV;
  }

  // SSR / build context
  return RAW_ENV || "http://localhost:8000";
}

export const API_BASE = resolveApiBase();

/**
 * Returns true when API_BASE looks like a real, reachable origin
 * for the current page (not a same-origin fallback, not a
 * localhost stub on a deployed site). Callers that want to fail
 * fast on a misconfigured deploy can gate their network calls on
 * this rather than catching `TypeError: Failed to fetch` deep
 * inside their submit handler.
 */
export function isApiBaseConfigured(): boolean {
  if (typeof window === "undefined") return Boolean(RAW_ENV);
  if (!RAW_ENV) return false;
  // Localhost on a deployed (https) page is unreachable.
  if (
    window.location.protocol === "https:" &&
    /\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(RAW_ENV)
  ) {
    return false;
  }
  return true;
}
