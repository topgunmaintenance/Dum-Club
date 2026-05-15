import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/project/topgun-maintenance loads cleanly as visitor", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/project/topgun-maintenance", { waitUntil: "networkidle" });
  await page.screenshot({
    path: "test-results/project-topgun.png",
    fullPage: true,
  });

  // Hard-fail on broken-route fallback. PRs #186-#196 left this
  // page behind a redirect on stale embed-config; this assertion
  // catches a regression to "Untitled Project" or 404.
  const headline = await page
    .locator("h1, h2")
    .first()
    .textContent({ timeout: 8_000 });
  expect(headline?.toLowerCase()).not.toContain("untitled");

  // Visitor view → no AdminBar (data attribute set by PR #175's
  // toolbar render). Signed-out users should never see it.
  await expect(page.locator("[data-dum-admin-bar]")).toHaveCount(0);

  assertNoCriticalErrors(errors);
});
