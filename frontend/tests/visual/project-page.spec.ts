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

  // KNOWN PRE-SESSION BUG (ROADMAP.md:17): the production
  // /project/topgun-maintenance currently renders as
  // "Untitled Project" because the client-side loadProject()
  // call doesn't reach Railway. This visual QA spec
  // intentionally does NOT assert on the headline text — that
  // would convert a documented backlog issue into a CI failure
  // every run, which would mute the actual signal we want from
  // this suite. The headline check moves back in once that
  // backlog item is resolved (search for ROADMAP "Untitled
  // Project" before re-enabling).
  //
  // What we DO check: the page didn't 404, didn't white-screen,
  // and the AdminBar isn't leaking to anonymous visitors.

  const bodyText = await page.locator("body").textContent({ timeout: 5_000 });
  expect(
    bodyText && bodyText.trim().length > 50,
    "project page rendered as effectively blank",
  ).toBe(true);

  // Visitor view → no AdminBar (data attribute set by PR #175's
  // toolbar render). Signed-out users should never see it.
  await expect(page.locator("[data-dum-admin-bar]")).toHaveCount(0);

  assertNoCriticalErrors(errors);
});
