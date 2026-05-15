/**
 * Shared helpers for the Visual QA suite.
 *
 * Two pieces every spec uses:
 *   - collectConsoleErrors(page): aggregates console.error +
 *     pageerror events so each test can assert "no React #310,
 *     no uncaught throws". Filters out known-noisy upstream
 *     SDK warnings the production silence wrapper also drops.
 *   - assertNoCriticalErrors(messages): hard-fails if any
 *     message matches a known-bad pattern (React minified
 *     errors, hydration mismatches, ChunkLoadError).
 */

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

// Substrings we drop from the console-error bucket. Production
// already silences these via AppProviders.tsx; mirror here so
// staging/preview builds where NODE_ENV !== "production" don't
// trip the assertion on noise we already know is harmless.
const IGNORED_FRAGMENTS = [
  "Wallet proxy not initialized",
  "Failed to add embedded wallet connector",
  "no Solana wallet connectors",
  // Vercel injects a CSP report that fires on every page in
  // dev mode; drop unless we genuinely care.
  "Refused to load the script",
  // Privy's SDK logs "useWallets was called outside the
  // PrivyProvider" once during hydration on the very first
  // render of certain routes — known race, harmless.
  "useWallets was called outside the PrivyProvider",
];

// Patterns that ALWAYS fail the test, even after filtering.
const CRITICAL_PATTERNS = [
  /Minified React error #\d+/i,
  /Rendered (?:more|fewer) hooks/i,
  /Cannot read propert(?:y|ies) of (?:undefined|null)/i,
  /Hydration failed/i,
  /ChunkLoadError/i,
  /Failed to fetch dynamically imported module/i,
];

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_FRAGMENTS.some((f) => text.includes(f))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = String(err && err.message ? err.message : err);
    if (IGNORED_FRAGMENTS.some((f) => text.includes(f))) return;
    errors.push(text);
  });
  return errors;
}

export function assertNoCriticalErrors(errors: string[]): void {
  const critical = errors.filter((e) =>
    CRITICAL_PATTERNS.some((p) => p.test(e)),
  );
  expect(
    critical,
    `Critical console errors detected:\n${critical.join("\n")}`,
  ).toEqual([]);
}
