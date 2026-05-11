#!/usr/bin/env node
/**
 * check-no-stray-text-white.mjs
 *
 * Regression guard. After the project page light-theme migration,
 * any `text-white` on a non-dark surface renders invisible. This
 * script walks frontend/app + frontend/components and fails the
 * build when `text-white` appears in a file that is NOT on the
 * allowlist below.
 *
 * The allowlist is a literal file list (not a regex on visual
 * context). Files on the list are either:
 *   - intentionally dark-themed pages or panels (admin, technology,
 *     leaderboard, verify, terms, privacy, dashboard tools, the
 *     embedded AI page, the IVS host/viewer),
 *   - shared UI primitives whose `text-white` is wrapped behind a
 *     dark or saturated bg variant (Button, Badge, etc.),
 *   - components that render inside a dark overlay (RewardToast,
 *     ProofOfPurchaseModal, LiveChat).
 *
 * To add a file to the allowlist, append it below and explain why
 * in the inline comment. Otherwise, swap `text-white` for
 * `text-primary` (or another semantic token) in the file itself.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

const SCAN_DIRS = [
  "frontend/app",
  "frontend/components",
];

// Files allowed to contain `text-white`. Match is by repo-relative
// path. Hover/group-hover/focus/placeholder variants and Tailwind
// classes paired with explicit dark/saturated backgrounds on the
// SAME element are always permitted regardless of file allowlist
// (see SAME_LINE_ALLOWLIST_PATTERNS below).
const FILE_ALLOWLIST = new Set([
  // Intentionally dark pages
  "frontend/app/technology/page.tsx",
  "frontend/app/leaderboard/page.tsx",
  "frontend/app/terms/page.tsx",
  "frontend/app/privacy/page.tsx",
  "frontend/app/verify/[code]/page.tsx",
  "frontend/app/ai/embed/[businessSlug]/page.tsx",
  // Admin tools (dark, internal)
  "frontend/app/admin/system/page.tsx",
  "frontend/app/admin/proofs/page.tsx",
  "frontend/app/admin/outreach/page.tsx",
  "frontend/app/dashboard/admin/page.tsx",
  "frontend/app/dashboard/review/page.tsx",
  "frontend/app/dashboard/ai-agent/page.tsx",
  "frontend/app/merchant/stripe-callback/page.tsx",
  // Live broadcast UI is dark by design
  "frontend/components/IVSStageHost.tsx",
  "frontend/components/IVSStageViewer.tsx",
  "frontend/components/LiveChat.tsx",
  "frontend/components/LiveChatIVS.tsx",
  // Modal / overlay components that paint dark
  "frontend/components/ProofOfPurchaseModal.tsx",
  "frontend/components/RewardToast.tsx",
  "frontend/components/DumPill.tsx",
  // Sales chat widget renders inside a dark pill
  "frontend/components/AiSalesChat.tsx",
  // Shared UI primitives with dark/saturated variants
  "frontend/components/ui/Button.tsx",
  "frontend/components/ui/Badge.tsx",
  "frontend/components/ui/Section.tsx",
  // Calculator and pop-in seller render text-white on saturated bg
  "frontend/components/FeeCalculator.tsx",
  "frontend/components/PopInSeller.tsx",
  "frontend/components/PopInSettings.tsx",
  "frontend/components/SimulatedTokenBanner.tsx",
  "frontend/components/UpgradeAnalyticsCard.tsx",
  "frontend/components/discover/StickyFilterBar.tsx",
  // Investor page contains a single text-white inside a dark CTA
  "frontend/app/investors/page.tsx",
  // Internal dev preview
  "frontend/app/_dev/preview/page.tsx",
  // Pricing/About/Discover/Business/Hub each have a single text-white
  // inside a saturated CTA; allow file-level
  "frontend/app/pricing/page.tsx",
  "frontend/app/business/page.tsx",
  "frontend/app/about/page.tsx",
  "frontend/app/discover/page.tsx",
  "frontend/app/hub/SolanaAdvanced.tsx",
]);

// Patterns that always pass even outside the allowlist. Anchors a
// `text-white` to a same-element dark/saturated background or a
// variant prefix so legitimate dark-CTA use stays green.
const SAME_LINE_ALLOWLIST_PATTERNS = [
  /\b(?:hover|focus|active|group-hover|focus-within|focus-visible|placeholder|disabled|checked):text-white\b/,
  /\btext-white\/\b/, // opacity-modified white used on dark by convention
  /\bbg-state-live\b[^"]*\btext-white\b/,
  /\bbg-(?:zinc|slate|neutral|gray|stone)-(?:[5-9]00|950)\b[^"]*\btext-white\b/,
  /\bbg-brand-(?:navy|teal-hover)\b[^"]*\btext-white\b/,
  /\bbg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:[5-9]00)\b[^"]*\btext-white\b/,
  /\bbg-black\b[^"]*\btext-white\b/,
  // SVG, CSS-in-JS, or inline style fragments
  /color:\s*['"]?#fff/,
  /color:\s*['"]?white/,
];

const ALLOWED_EXT = new Set([".tsx", ".ts", ".jsx", ".js"]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (ALLOWED_EXT.has(full.slice(full.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));
  const violations = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
    if (FILE_ALLOWLIST.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    if (!/\btext-white\b/.test(src)) continue;
    const lines = src.split("\n");
    lines.forEach((line, idx) => {
      if (!/\btext-white\b/.test(line)) return;
      if (SAME_LINE_ALLOWLIST_PATTERNS.some((re) => re.test(line))) return;
      violations.push({ rel, line: idx + 1, text: line.trim().slice(0, 160) });
    });
  }

  if (violations.length === 0) {
    console.log(`check-no-stray-text-white: scanned ${files.length} files, no violations.`);
    process.exit(0);
  }
  console.error(`check-no-stray-text-white: ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}`);
    console.error(`    ${v.text}`);
  }
  console.error(`\nFix: swap text-white -> text-primary (or another semantic token), or add the file to FILE_ALLOWLIST in scripts/check-no-stray-text-white.mjs with a comment explaining why the surface is dark.`);
  process.exit(1);
}

main();
