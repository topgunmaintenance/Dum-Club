import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

/**
 * Smoke test for the host-site bubble.
 *
 * Loads embed.js inside a synthetic merchant page using
 * page.setContent() instead of a data: URL. data: URLs give
 * the test page an opaque origin which breaks several embed.js
 * code paths (CORS preflight to embed-config, postMessage
 * origin guards, IntersectionObserver root resolution). The
 * setContent path gives the page an "about:blank"-like origin
 * that embed.js handles cleanly.
 *
 * We navigate to the real dum.club origin first so the page
 * inherits a same-origin context for the script load — then
 * setContent rewrites the document. This matches the
 * environment a real merchant page is rendered into.
 */

test("embed.js bubble loads on a stub host page", async ({ page, baseURL }) => {
  const errors = collectConsoleErrors(page);

  // Land on a real same-origin page first so subsequent script
  // loads inherit the right CORS/CSP context. The page itself
  // is irrelevant — we throw it away with setContent.
  await page.goto(baseURL || "https://www.dum.club", {
    waitUntil: "domcontentloaded",
  });

  // Replace the document with a minimal merchant-page stub.
  // This keeps the same origin (no opaque data: URL pitfalls)
  // while still presenting embed.js with a fresh document
  // body to inject into.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Test Host</title>
<style>body { margin: 0; padding: 32px; font: 16px sans-serif; background: #fff; color: #000; }</style>
</head><body>
<h1>Test merchant page</h1>
<p>DUM Club bubble should appear in the bottom-right corner.</p>
<script
  src="${baseURL}/embed.js"
  data-business-id="topgun-maintenance"
  async
></script>
</body></html>`;

  await page.setContent(html, { waitUntil: "domcontentloaded" });

  // Bubble injection is async: script load (~200ms) +
  // embed-config fetch + 240ms fade-in. Poll up to 12s.
  const bubble = page.locator("[data-dum-embed-bubble]");
  try {
    await expect(bubble).toBeVisible({ timeout: 12_000 });
  } catch (e) {
    // If embed.js failed to inject (e.g. embed-config 503'd
    // and the fallback path also failed), capture the document
    // state for debugging instead of generic "not visible".
    const html = await page.content();
    console.warn(
      "embed-bubble.spec: bubble never appeared. First 1000 chars of document:\n",
      html.slice(0, 1000),
    );
    throw e;
  }

  await page.screenshot({
    path: "test-results/embed-bubble.png",
    fullPage: false,
  });

  await expect(bubble.locator(".dum-clip")).toBeVisible();

  assertNoCriticalErrors(errors);
});
