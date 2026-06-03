/**
 * Regression tests for lib/discover/filters.ts isDiscoverable.
 *
 * Dependency-free `node --test` target (mirrors the inline-copy convention
 * of offers.test.mjs / storeStatus.test.mjs — filters.ts isn't compiled at
 * test time, so the small surface under test is re-implemented here; keep
 * the two in sync).
 *
 * Run: node --test frontend/__tests__/lib/discover-filters.test.mjs
 *
 * Pins the contract that an actively-live store is always discoverable
 * (the "live but invisible on /discover" bug), without regressing the junk
 * filter for non-live stores.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

function hasOffers(project) {
  return Array.isArray(project.store_items) && project.store_items.length > 0;
}

// ── Inline copy of isDiscoverable (mirrors lib/discover/filters.ts) ──
function isDiscoverable(project) {
  if (project.is_live === true) return true;
  if (!project.verified && !hasOffers(project)) return false;
  const desc = (project.description || "").trim();
  if (desc.length < 20) return false;
  const title = (project.title || project.name || "").trim().toLowerCase();
  if (title.startsWith("auto-created")) return false;
  if (title.startsWith("no description")) return false;
  return true;
}

test("a live store is discoverable even with a thin profile", () => {
  // Website designer's real shape: live, unverified, no offers, blank desc.
  const live = {
    name: "Website designer",
    is_live: true,
    verified: false,
    store_items: [],
    description: "",
  };
  assert.equal(isDiscoverable(live), true);
});

test("an offline unverified store with no offers is NOT discoverable", () => {
  const offline = {
    name: "Website designer",
    is_live: false,
    verified: false,
    store_items: [],
    description: "",
  };
  assert.equal(isDiscoverable(offline), false);
});

test("offline junk (short desc, no offers, unverified) stays hidden", () => {
  const junk = {
    name: "ZombiWave: Endless Survival Shooter",
    is_live: false,
    verified: false,
    store_items: [],
    description: "AI game",
  };
  assert.equal(isDiscoverable(junk), false);
});

test("verified merchant is discoverable offline", () => {
  const verified = {
    name: "Topgun Maintenance LLC",
    is_live: false,
    verified: true,
    store_items: [],
    description: "FAA-certified aircraft maintenance in Morristown, NJ.",
  };
  assert.equal(isDiscoverable(verified), true);
});

test("offline store with offers + real description is discoverable", () => {
  const ready = {
    name: "Sparkle Pro Mobile Wash",
    is_live: false,
    verified: false,
    store_items: [{ price_usd: 40 }],
    description: "Mobile detailing that comes to your driveway, same-day.",
  };
  assert.equal(isDiscoverable(ready), true);
});
