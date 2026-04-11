/**
 * Returns the backend API base URL.
 *
 * Safety: if NEXT_PUBLIC_API_URL was baked as http:// during build but the site
 * is served over HTTPS, the browser blocks the request (mixed content).
 * This helper upgrades http → https at runtime when the page is on HTTPS.
 */
const raw = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const API_BASE =
  typeof window !== "undefined" &&
  window.location.protocol === "https:" &&
  raw.startsWith("http://") &&
  !raw.includes("localhost")
    ? raw.replace("http://", "https://")
    : raw;
