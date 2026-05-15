import { test, expect } from "@playwright/test";
import { collectConsoleErrors, assertNoCriticalErrors } from "./_helpers";

test("/project/topgun-maintenance loads cleanly as visitor", async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);

  await page.goto("/project/topgun-maintenance", {
    waitUntil: "domcontentloaded",
  });
  // Wait for SOMETHING to render. The page does its own
  // client-side data fetch (loadProject() at /project/[id]/
  // page.tsx:801). Wait up to 12s for any heading.
  await page.locator("h1, h2").first().waitFor({
    state: "visible",
    timeout: 12_000,
  });
  await page.screenshot({
    path: "test-results/project-topgun.png",
    fullPage: true,
  });

  // Headline assertion (re-enabled): the client-side
  // loadProject() fetch is now hitting Railway and the seeded
  // Topgun row is hydrating, so the page no longer falls back
  // to "Untitled Project". This is the canary that catches a
  // regression in the project-fetch path — if loadProject()
  // ever silently fails again, the headline collapses to the
  // placeholder and this assertion fires.
  const bodyText = await page.locator("body").textContent({ timeout: 5_000 });
  expect(
    bodyText && bodyText.trim().length > 50,
    "project page rendered as effectively blank",
  ).toBe(true);
  expect(
    bodyText?.toLowerCase().includes("untitled project"),
    "project page fell back to 'Untitled Project' placeholder — loadProject() likely not reaching Railway (was ROADMAP active diagnostic)",
  ).toBe(false);

  // Visitor view → no AdminBar (data attribute set by PR #175's
  // toolbar render). Signed-out users should never see it.
  await expect(page.locator("[data-dum-admin-bar]")).toHaveCount(0);

  assertNoCriticalErrors(errors);
});
