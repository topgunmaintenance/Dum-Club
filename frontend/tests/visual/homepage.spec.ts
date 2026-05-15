import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("homepage loads with branded navbar + tagline", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/", { waitUntil: "networkidle" });
  await page.screenshot({ path: "test-results/homepage.png", fullPage: false });

  // Navbar wordmark + tagline lockup (PR #185).
  await expect(page.locator("text=DUM").first()).toBeVisible();
  await expect(page.locator("text=CLUB").first()).toBeVisible();
  await expect(page.locator("text=Drive Your Market").first()).toBeVisible();

  assertNoCriticalErrors(errors);
});
