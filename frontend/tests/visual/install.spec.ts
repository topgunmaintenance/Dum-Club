import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/install (signed out) renders sign-in CTA without React #310", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/install", { waitUntil: "domcontentloaded" });

  // Wait for the install page heading specifically — also acts
  // as the auth-resolution gate (heading only renders after
  // authLoading flips false; PR #189 hydration fix). Heading copy
  // history: PR #230 set it to "Embed on your site (optional)";
  // the merchant plain-language pass (#336) renamed it to
  // "Add to your website (optional)" to match the page's main
  // heading and drop developer jargon. Keep this matcher in sync
  // with app/install/page.tsx's signed-out <h1>.
  await expect(
    page.getByRole("heading", { name: /Add to your website/i }),
  ).toBeVisible({ timeout: 12_000 });

  await page.screenshot({ path: "test-results/install.png", fullPage: false });

  // Anonymous → sign-in CTA inside the page's <main>. We have
  // to scope to <main> because Navbar.tsx renders its own
  // "Sign in" buttons (mobile + desktop) on lines 232 + 353,
  // so a page-wide getByRole("button", { name: "Sign in" })
  // matches 3 elements and toBeVisible() can't disambiguate.
  await expect(
    page
      .locator("main")
      .getByRole("button", { name: /^Sign in$/i }),
  ).toBeVisible({ timeout: 10_000 });

  assertNoCriticalErrors(errors);
});
