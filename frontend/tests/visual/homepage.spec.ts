import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("homepage loads with branded navbar + tagline", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("nav").first().waitFor({
    state: "visible",
    timeout: 12_000,
  });
  await page.screenshot({ path: "test-results/homepage.png", fullPage: false });

  // Navbar tagline (PR #185). Navbar mounts TWO BrandMark
  // instances — one for mobile (lg:hidden), one for desktop
  // (hidden lg:flex) — so the tagline text is in the DOM
  // twice. The first match is the mobile copy which is
  // display:none on the Desktop Chrome test viewport;
  // .first() + toBeVisible() therefore times out.
  //
  // Right shape: assert at least one visible "Drive Your
  // Market" element. Filter to visible-only via Playwright's
  // native :visible CSS pseudo so we don't have to hand-pick
  // .nth(0) vs .nth(1) (a future Navbar refactor could change
  // DOM order).
  const taglineVisible = page.locator(
    'css=*:has-text("Drive Your Market"):visible',
  );
  await expect(taglineVisible.first()).toBeVisible({ timeout: 10_000 });

  assertNoCriticalErrors(errors);
});
