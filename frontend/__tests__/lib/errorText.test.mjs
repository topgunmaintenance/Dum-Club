/**
 * Regression tests for lib/errorText.ts (errorText).
 *
 * Dependency-free `node --test` target. The behaviour below mirrors
 * lib/errorText.ts exactly — if you change one, change both. (Same
 * convention as storeStatus.test.mjs / offers.test.mjs: the .ts isn't
 * compiled at test time, so we re-implement the small pure surface
 * inline.)
 *
 * Run:   node --test frontend/__tests__/lib/errorText.test.mjs
 *
 * The point of this helper is that NO error shape ever renders as
 * "[object Object]" in a user-facing banner — so the tests assert the
 * object/array shapes resolve to their human message, never to the
 * default Object stringification.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// ── Inline copy of errorText (mirrors lib/errorText.ts) ──
function errorText(input, fallback = "Something went wrong. Try again.") {
  if (input == null) return fallback;
  if (typeof input === "string") return input.trim() || fallback;
  if (input instanceof Error) return errorText(input.message, fallback);
  if (Array.isArray(input)) {
    const parts = input
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          if (typeof item.msg === "string") return item.msg.trim();
          if (typeof item.message === "string") return item.message.trim();
        }
        return "";
      })
      .filter((s) => s.length > 0);
    return parts.length ? parts.join("; ") : fallback;
  }
  if (typeof input === "object") {
    if ("detail" in input) return errorText(input.detail, fallback);
    if (typeof input.message === "string") return input.message.trim() || fallback;
    if (typeof input.msg === "string") return input.msg.trim() || fallback;
  }
  return fallback;
}

const FALLBACK = "Something went wrong. Try again.";

test("plain string passes through", () => {
  assert.equal(errorText("Card declined."), "Card declined.");
});

test("blank / null / undefined fall back", () => {
  assert.equal(errorText(""), FALLBACK);
  assert.equal(errorText("   "), FALLBACK);
  assert.equal(errorText(null), FALLBACK);
  assert.equal(errorText(undefined), FALLBACK);
});

test("custom fallback is honoured", () => {
  assert.equal(errorText(null, "Bid failed"), "Bid failed");
  assert.equal(errorText({}, "Pin failed"), "Pin failed");
});

test("FastAPI string detail unwraps", () => {
  assert.equal(errorText({ detail: "Stripe not connected." }), "Stripe not connected.");
});

test("FastAPI structured detail uses .message", () => {
  assert.equal(
    errorText({ detail: { code: "merchant_limits_unresolved", message: "Your plan limits aren't set up yet." } }),
    "Your plan limits aren't set up yet.",
  );
});

test("FastAPI 422 array joins msg fields — never [object Object]", () => {
  const body = {
    detail: [
      { loc: ["body", "amount"], msg: "value is not a valid float", type: "type_error.float" },
      { loc: ["body", "title"], msg: "field required", type: "value_error.missing" },
    ],
  };
  const out = errorText(body);
  assert.equal(out, "value is not a valid float; field required");
  assert.ok(!out.includes("[object Object]"));
});

test("Error instance uses its message", () => {
  assert.equal(errorText(new Error("Network error")), "Network error");
});

test("bare object with message", () => {
  assert.equal(errorText({ message: "Bid too low." }), "Bid too low.");
});

test("unknown object shape never leaks [object Object]", () => {
  const out = errorText({ weird: { nested: 1 } }, "Bid failed");
  assert.equal(out, "Bid failed");
  assert.ok(!out.includes("[object Object]"));
});

test("array of plain strings joins", () => {
  assert.equal(errorText(["too low", "auction closed"]), "too low; auction closed");
});
