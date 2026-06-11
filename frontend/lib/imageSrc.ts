/**
 * Storefront image src resolution.
 *
 * ── ROOT-CAUSE / PATH-MISMATCH RECONCILIATION (flagged, not guessed) ──
 * The DB seed (031_topgun_storefront_seed.sql) sets storefront image URLs to
 * local paths under the `/images/topgun/` folder. Those assets were
 * meant to be vendored into `frontend/public/images/topgun/` by
 * `scripts/fetch-topgun-photos.sh` BEFORE deploy — but that script is a manual
 * step that is NOT wired into the Vercel build, so the directory was never
 * committed and does not exist in the build. Result: every `/images/topgun/*`
 * URL 404s in production. (The migration-033 "fix" repointed some of them to
 * `https://topgunmaintenance.com/...`, but that origin now returns 403 — a
 * fragile hotlink, which is exactly why we don't render external hotlinks.)
 *
 * We cannot re-fetch the originals (source 403s). So instead of letting the
 * uncommitted legacy paths 404, we rewrite them at render time:
 *   - content images (offer / gallery / hero) -> a committed placeholder, so
 *     a real image always renders and no request hits the dead path.
 *   - avatars/logos -> null, so the existing emoji/gradient avatar fallback
 *     kicks in (nicer than a placeholder for a small avatar).
 *
 * The REAL fix for the actual photos is data, not code: the owner re-uploads
 * them via the merchant image uploader (durable Supabase-hosted URLs), which
 * replaces these legacy seed paths. This util just guarantees no broken image
 * / no 404 in the meantime, and covers any future uncommitted local path.
 */

export const STOREFRONT_PLACEHOLDER = "/images/storefront-placeholder.svg";

// Local /public paths that the repo is known NOT to vendor. Anything under
// these prefixes is treated as missing (rewritten to the placeholder / null)
// rather than requested.
const UNVENDORED_LOCAL_PREFIXES = ["/images/topgun/"];

function isUnvendoredLocalPath(url: string): boolean {
  return UNVENDORED_LOCAL_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * For content images (offer / gallery / hero): always return a renderable
 * src. Empty/missing or known-uncommitted local paths resolve to the
 * committed placeholder so nothing 404s and a real image always shows.
 */
export function resolveImageUrl(url?: string | null): string {
  const u = (url || "").trim();
  if (!u || isUnvendoredLocalPath(u)) return STOREFRONT_PLACEHOLDER;
  return u;
}

/**
 * For avatars/logos that prefer the existing emoji/gradient fallback: returns
 * null for empty or known-uncommitted local paths (so the caller's null path
 * renders the avatar fallback and no request hits the dead path), else the url.
 */
export function cleanLogoUrl(url?: string | null): string | null {
  const u = (url || "").trim();
  if (!u || isUnvendoredLocalPath(u)) return null;
  return u;
}
