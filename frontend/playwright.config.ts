import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Visual QA workflow.
 *
 * Targets the Vercel-hosted dum.club deployment (or any URL
 * passed via BASE_URL env). Tests are read-only smoke checks
 * against anonymous flows — no login. Sign-in coverage is
 * deferred until a Privy test account is wired up.
 *
 * Browsers: Chromium only. Firefox + WebKit add ~2x runtime
 * for marginal coverage gain at this stage.
 */
export default defineConfig({
  testDir: "./tests/visual",
  // Each spec is a smoke check; one retry catches a stray
  // network blip without masking real regressions.
  retries: process.env.CI ? 1 : 0,
  // Hard cap so a hung selector never blows the workflow budget.
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    // Plain-text summary the GitHub Action picks up to comment
    // on the PR. Custom reporter implemented inline below.
    ["./tests/visual/summary-reporter.ts"],
  ],
  outputDir: "test-results",
  use: {
    baseURL: process.env.BASE_URL || "https://www.dum.club",
    // Always capture for the artifact. Failure-only would still
    // catch regressions but baseline screenshots help eyeball
    // visual drift on green runs too.
    screenshot: "on",
    video: "off",
    trace: "retain-on-failure",
    // dum.club sometimes takes a beat on first paint. Tests
    // explicitly waitForLoadState("networkidle") where needed.
    navigationTimeout: 20_000,
    actionTimeout: 8_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
