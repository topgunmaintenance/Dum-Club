import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("homepage loads with branded navbar + tagline", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Wait for the navbar to actually mount (Privy SSR/CSR
  // boundary can leave navbar hidden during the first paint).
  await page.locator("nav, [data-dum-admin-bar], header").first().waitFor({
    state: "visible",
    timeout: 12_000,
  });
  await page.screenshot({ path: "test-results/homepage.png", fullPage: false });

  // Navbar tagline (PR #185). The tagline copy is unique on the
  // page so a single text= match is safe — earlier "text=DUM"
  // would also match buried "DUM Points" copy.
  await expect(
    page.locator("text=Drive Your Market").first(),
  ).toBeVisible({ timeout: 10_000 });

  assertNoCriticalErrors(errors);
});
