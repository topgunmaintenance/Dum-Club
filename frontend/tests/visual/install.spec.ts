import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/install (signed out) renders sign-in CTA without React #310", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/install", { waitUntil: "networkidle" });
  await page.screenshot({ path: "test-results/install.png", fullPage: false });

  // Heading is always present regardless of auth state.
  await expect(
    page.getByRole("heading", { name: /Add DUM Club to your website/i }),
  ).toBeVisible();

  // Anonymous → sign-in CTA. The QA T4 fix (PR #189) wrapped
  // the page in an authLoading skeleton; once auth resolves and
  // the user is anonymous we land on the Sign in button.
  await expect(
    page.getByRole("button", { name: /^Sign in$/i }),
  ).toBeVisible({ timeout: 10_000 });

  assertNoCriticalErrors(errors);
});
