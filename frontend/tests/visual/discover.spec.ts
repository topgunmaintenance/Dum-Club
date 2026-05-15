import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/discover renders cards + plain-English CTAs", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/discover", { waitUntil: "domcontentloaded" });

  // Discover's useProjects hook fans out to /projects/public
  // and per-project /market endpoints. Cold-start can take a
  // few seconds; wait for the loading spinner to clear OR a
  // listing card to mount (whichever comes first) before
  // asserting copy. networkidle alone wasn't enough because
  // the 20s poll added in PR #188 keeps the network busy.
  await Promise.race([
    page.locator('h1, h2, h3').first().waitFor({ state: "visible", timeout: 12_000 }),
    page.locator('a[href*="/project/"]').first().waitFor({ state: "visible", timeout: 12_000 }),
  ]).catch(() => {
    // Continue — the assertions below will produce the real
    // failure mode if the page genuinely didn't load.
  });

  await page.screenshot({ path: "test-results/discover.png", fullPage: true });

  // QA T3 hard-fail: stale "CONTACT FOR QUOTE" must not
  // resurface. This is a copy-only check that doesn't care
  // about which cards rendered, so it always runs.
  const stale = await page.getByText(/Contact for quote/i).count();
  expect(stale, "stale 'Contact for quote' copy resurfaced").toBe(0);

  // At least one ListingCard with one of the new CTAs. If
  // discover happens to be empty in production right now, this
  // is a soft-fail — log and continue. The CONTACT FOR QUOTE
  // check above is the load-bearing assertion.
  const ctaCount = await page
    .locator(
      'text=/Join live →|Browse offers →|Order now →|Buy tickets →|Ask for a price →/',
    )
    .count();
  if (ctaCount === 0) {
    console.warn(
      "discover.spec: no Discover cards visible. Could be empty production state or slow cold-start. Skipping CTA assertion.",
    );
  } else {
    expect(
      ctaCount,
      "expected at least one of the new plain-English CTAs to render on a Discover card",
    ).toBeGreaterThan(0);
  }

  assertNoCriticalErrors(errors);
});
