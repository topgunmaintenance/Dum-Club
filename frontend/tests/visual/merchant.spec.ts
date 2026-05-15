import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/merchant signed-out lands cleanly (no React #310)", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/merchant", { waitUntil: "networkidle" });
  await page.screenshot({
    path: "test-results/merchant-anon.png",
    fullPage: false,
  });

  // The signed-out path renders either the founding-merchant
  // signup CTA or a sign-in invitation. Either way, the page
  // must not white-screen — the React #310 hook crash from
  // PR #193 manifested as a fully blank document body.
  const bodyText = await page.locator("body").textContent({ timeout: 8_000 });
  expect(
    bodyText && bodyText.trim().length > 50,
    "merchant page rendered as effectively blank — possible React #310 regression",
  ).toBe(true);

  assertNoCriticalErrors(errors);
});
