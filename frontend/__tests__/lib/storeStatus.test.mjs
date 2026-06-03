/**
 * Regression tests for lib/storeStatus.ts (deriveStoreStatusCta).
 *
 * Dependency-free `node --test` target. The behaviour below mirrors
 * lib/storeStatus.ts exactly — if you change one, change both. (Same
 * convention as offers.test.mjs: the .ts isn't compiled at test time,
 * so we re-implement the small pure surface inline.)
 *
 * Run:   node --test frontend/__tests__/lib/storeStatus.test.mjs
 *
 * Covers the merchant Store Status card states (per the UX ticket):
 *   - no offer            → "Add Offer"
 *   - offer, not live     → "Go Live"
 *   - live                → "Copy Store Link"
 *   - the dead "Submit for Review" flow never appears in any state
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Inline copy of deriveStoreStatusCta (mirrors lib/storeStatus.ts) ──
function deriveStoreStatusCta(input) {
  if (!input.hasOffer) {
    return {
      nextStep: "Add your first offer so customers can buy.",
      primaryLabel: "Add Offer",
      primaryAction: "add_offer",
    };
  }
  if (!input.storeIsLive) {
    return {
      nextStep: "Go live when you are ready to sell.",
      primaryLabel: "Go Live",
      primaryAction: "go_live",
    };
  }
  return {
    nextStep: "Your store is live. Share your link.",
    primaryLabel: "Copy Store Link",
    primaryAction: "copy_link",
  };
}

test("no offer → Add Offer", () => {
  const cta = deriveStoreStatusCta({ hasOffer: false, storeIsLive: false });
  assert.equal(cta.primaryAction, "add_offer");
  assert.equal(cta.primaryLabel, "Add Offer");
  assert.match(cta.nextStep, /add your first offer/i);
});

test("no offer → Add Offer even if a stale live flag is set", () => {
  // hasOffer is the dominant gate — without something to sell, "live"
  // is meaningless and we must still ask for the first offer.
  const cta = deriveStoreStatusCta({ hasOffer: false, storeIsLive: true });
  assert.equal(cta.primaryAction, "add_offer");
});

test("offer exists but not live → Go Live", () => {
  const cta = deriveStoreStatusCta({ hasOffer: true, storeIsLive: false });
  assert.equal(cta.primaryAction, "go_live");
  assert.equal(cta.primaryLabel, "Go Live");
  assert.match(cta.nextStep, /go live when you are ready/i);
});

test("live → Copy Store Link", () => {
  const cta = deriveStoreStatusCta({ hasOffer: true, storeIsLive: true });
  assert.equal(cta.primaryAction, "copy_link");
  assert.equal(cta.primaryLabel, "Copy Store Link");
  assert.match(cta.nextStep, /your store is live/i);
});

test("no state ever surfaces the dead review flow", () => {
  for (const hasOffer of [true, false]) {
    for (const storeIsLive of [true, false]) {
      const cta = deriveStoreStatusCta({ hasOffer, storeIsLive });
      assert.doesNotMatch(cta.primaryLabel, /review/i);
      assert.doesNotMatch(cta.nextStep, /review|approval|publication/i);
      assert.ok(["add_offer", "go_live", "copy_link"].includes(cta.primaryAction));
    }
  }
});
