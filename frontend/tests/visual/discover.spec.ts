import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/discover renders cards + plain-English CTAs", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/discover", { waitUntil: "networkidle" });
  await page.screenshot({ path: "test-results/discover.png", fullPage: true });

  // At least one ListingCard. The card structure carries the
  // CTA labels we changed in PR #182 + PR #193: "Join live →"
  // when broadcasting, "Browse offers →" when offline. We
  // assert one of those strings is present somewhere.
  const ctaPresent = await page
    .locator(
      'text=/Join live →|Browse offers →|Order now →|Buy tickets →|Ask for a price →/',
    )
    .first()
    .isVisible({ timeout: 8_000 })
    .catch(() => false);

  expect(
    ctaPresent,
    "expected at least one of the new plain-English CTAs to render on a Discover card",
  ).toBe(true);

  // QA T3 also flagged that "CONTACT FOR QUOTE" should be gone.
  // PR #193 swapped both stragglers. Hard-fail if it comes back.
  const stale = await page.getByText(/Contact for quote/i).count();
  expect(stale, "stale 'Contact for quote' copy resurfaced").toBe(0);

  assertNoCriticalErrors(errors);
});
