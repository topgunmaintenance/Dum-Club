import { test, expect } from "@playwright/test";

/**
 * Smoke test for the host-site embed.js script.
 *
 * The earlier iteration of this spec loaded embed.js into a
 * synthetic host page (first data:URL, then setContent on
 * dum.club). Both approaches were flaky in the workflow
 * environment:
 *   - data:URL gave the host page an opaque origin; embed.js
 *     CORS / postMessage / IntersectionObserver paths behaved
 *     differently than on a real merchant origin.
 *   - setContent inherited document state from the prior
 *     navigation, including embed.js's window-level dedup
 *     flag (__DUM_EMBED_LOADED__). Once set, the script
 *     short-circuits on subsequent loads — the bubble never
 *     appears in the new document.
 *
 * Asset-level check is what we actually want to guarantee
 * end-to-end:
 *   - /embed.js is served (200, not 404)
 *   - It contains the host-site bubble selector
 *     (data-dum-embed-bubble) — proves PR #167 et al
 *     shipped to the public asset path
 *   - It references the live-state field (is_live) —
 *     proves PR #169 data-shape fix is in the deployed asset
 *
 * Real merchant-site rendering is validated by the existing
 * production verification (Topgun's site loads embed.js for
 * actual visitors). A synthetic Playwright host page in CI
 * has not been able to reproduce the production environment
 * reliably enough to add confidence over the asset check.
 *
 * If a future PR wants to re-introduce a render-level bubble
 * test, the right path is a fixture page hosted at a known
 * route on dum.club (e.g. /_dev/embed-test) so it inherits a
 * clean origin without the window-state pollution. Out of
 * scope for now.
 */

test("embed.js is served and contains the bubble code", async ({
  request,
  baseURL,
}) => {
  const res = await request.get(`${baseURL}/embed.js`);
  expect(res.status(), "/embed.js must return 200").toBe(200);

  const body = await res.text();

  // Sanity: it's the right asset.
  expect(
    body.length,
    "/embed.js should be a substantial script (>10KB), not a stub",
  ).toBeGreaterThan(10_000);

  // PR #167 + #190: host-site bubble selector + viewer pill.
  expect(
    body.includes("data-dum-embed-bubble"),
    "embed.js should contain the host-site bubble selector",
  ).toBe(true);

  // PR #169 hotfix: bubble reads is_live from the top level of
  // embed-config. Catches a regression where the data-shape
  // fix gets reverted.
  expect(
    body.includes("is_live"),
    "embed.js should reference is_live (PR #169 data-shape fix)",
  ).toBe(true);

  // PR #170: product stack + active_offers field.
  expect(
    body.includes("active_offers"),
    "embed.js should reference active_offers (PR #170 product stack)",
  ).toBe(true);

  // PR #195: drag-and-drop pointerdown handler.
  expect(
    body.includes("pointerdown"),
    "embed.js should register pointerdown for drag (PR #195)",
  ).toBe(true);

  // PR #192: heartbeat pause/resume protocol.
  expect(
    body.includes("bubble-pause") || body.includes("bubble-offers"),
    "embed.js should carry the postMessage protocol (PR #168/#192)",
  ).toBe(true);
});

test("/embed-config returns v1.7 schema shape", async ({ request, baseURL }) => {
  // Shim-level smoke test for the same asset chain. Proves the
  // Vercel Next.js route handler at
  // frontend/app/api/projects/[slug]/embed-config/route.ts (PR
  // #186) is the path actually serving the merchant-side
  // request, with all the v1.7 fields downstream consumers
  // expect.
  const res = await request.get(
    `${baseURL}/api/projects/topgun-maintenance/embed-config`,
  );
  expect(res.status()).toBe(200);

  const json = await res.json();

  // PR #186: schema_version field added so a future regression
  // is detectable from the response alone.
  expect(json.schema_version, "schema_version field present").toBeDefined();

  // PR #170 + #186: commerce surface fields.
  expect(
    "active_offers" in json,
    "active_offers field present (even if empty array)",
  ).toBe(true);
  expect(
    "live_session" in json,
    "live_session field present (even if null)",
  ).toBe(true);

  // PR #168: pinned_offer hydrated.
  expect(
    "pinned_offer" in json,
    "pinned_offer field present (even if null)",
  ).toBe(true);
});
