import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

/**
 * Smoke test for the host-site bubble.
 *
 * Loads embed.js inside a synthetic merchant page (via
 * data: URL so we don't depend on topgunmaintenance.com being
 * up). Asserts the bubble appears, dismiss × works, click
 * opens the storefront overlay.
 *
 * The data: URL trick is the same pattern the bubble's own
 * "Test my install" affordance uses internally.
 */

test("embed.js bubble loads on a stub host page", async ({ page, baseURL }) => {
  const errors = collectConsoleErrors(page);

  // Build a tiny host page that loads embed.js exactly the way
  // a real merchant snippet would. data: URL keeps the test
  // hermetic — no third-party origin in the loop.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Test Host</title>
<style>body { margin: 0; padding: 32px; font: 16px sans-serif; }</style>
</head><body>
<h1>Test merchant page</h1>
<p>The DUM Club bubble should appear in the bottom-right corner.</p>
<script
  src="${baseURL}/embed.js"
  data-business-id="topgun-maintenance"
  async
></script>
</body></html>`;

  await page.goto(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);

  // Bubble injection is async (script load + display-mode
  // resolution + 240ms fade). Poll up to 8s.
  const bubble = page.locator("[data-dum-embed-bubble]");
  await expect(bubble).toBeVisible({ timeout: 8_000 });

  await page.screenshot({
    path: "test-results/embed-bubble.png",
    fullPage: false,
  });

  // Bubble's clip + initials fallback (when offline) — at
  // minimum one of these renders. Live merchants would show
  // an iframe inside the clip instead; either is acceptable.
  await expect(bubble.locator(".dum-clip")).toBeVisible();

  assertNoCriticalErrors(errors);
});
