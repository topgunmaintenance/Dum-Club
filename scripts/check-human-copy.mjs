#!/usr/bin/env node
/**
 * check-human-copy.mjs
 *
 * Static guard against robotic / over-polished marketing copy on
 * customer-facing surfaces. Scans the public pages, shared
 * components, and merchant-onboarding flows for:
 *
 *   - em dashes (—) and en dashes (–) in user-visible strings
 *   - repeated dash separators (" — ... — ")
 *   - banned SaaS / AI-marketing words
 *   - specific phrases that the founder explicitly wants rewritten
 *
 * Lines that are clearly code (imports, type defs, comments,
 * tailwind class strings, variable identifiers) are ignored so
 * the guard only flags rendered copy.
 *
 * Run with: npm run check:human-copy
 * Exit code is non-zero when any violation is found.
 */

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

// ---------------------------------------------------------------------------
// 1. Scan targets — customer-facing surfaces only.
// ---------------------------------------------------------------------------

const SCAN_DIRS = [
  "frontend/app",
  "frontend/components",
];

// Files under these paths are NOT customer-facing copy and are
// skipped entirely. Admin tools, API routes, dev previews, tests
// and assets do not need the guard.
const EXCLUDE_PATH_FRAGMENTS = [
  "/frontend/app/admin/",
  "/frontend/app/api/",
  "/frontend/app/_dev/",
  "/frontend/app/auth/",
  "/__tests__/",
  "/node_modules/",
  "/.next/",
  "globals.css",
];

const ALLOWED_EXT = new Set([".tsx", ".ts", ".jsx", ".js"]);

// ---------------------------------------------------------------------------
// 2. Banned phrases — robotic SaaS / AI marketing language.
//    Whole-word, case-insensitive.
// ---------------------------------------------------------------------------

const BANNED_WORDS = [
  "seamlessly",
  "cutting-edge",
  "comprehensive",
  "optimize",
  "empower",
  "elevate",
  "robust",
  "leverage",
  "frictionless",
  "industry-leading",
  "world-class",
  "revolutionary",
  "game-changing",
  "streamline",
  "next-generation",
  "state-of-the-art",
  "best-in-class",
];

// "unlock" is banned as marketing copy but is also a legitimate
// product term ("unlock dashboard / unlock perk"). Only flag it
// when it shows up inside obvious marketing text (JSX text
// content), not when used as a verb in identifiers.
const SOFT_BANNED_WORDS = [
  "unlock",
];

// Hard-banned exact phrases that have appeared on dum.club and
// must be rewritten. Case-insensitive substring match.
const BANNED_PHRASES = [
  "AI retention agent",
  "AI retention",
  "cross-merchant discovery",
  "technical layer",
  "canonical state",
  "source of truth",
  "one system — one bill",
  "one system, one bill",
  "Money goes straight to your bank — never to us",
  "Paste one script tag. Or list on DUM Club",
  "Every purchase earns DUM Points — loyalty rewards",
  // Founding-pricing wording the doctrine forbids: vague about what the
  // merchant actually pays after the trial. Use the canonical
  // "Lock in founding pricing for life" instead.
  "preferred founding pricing",
  "preferred pricing after launch",
];

// Approved compound words / brand terms that look like
// hyphenated marketing speak but are normal English. Lines
// containing one of these strings will NOT be flagged for the
// hyphen-containing banned word it overlaps.
const APPROVED_COMPOUNDS = [
  "real-time",
  "first-time",
  "mobile-first",
  "pop-in",
  "ai-powered",
  "faa-certified",
  "time-sensitive",
  "in-app",
  "follow-up",
  "same-day",
  "off-peak",
  "mid-size",
  "drive ur market",
  "0% commission, always",
  "keep every sale",
];

// ---------------------------------------------------------------------------
// 3. Line filters — drop lines that are obviously not display copy.
// ---------------------------------------------------------------------------

function isCodeLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  // Block-comment lines
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/")) return true;
  // Imports / exports of types
  if (/^(import|export)\b/.test(trimmed)) return true;
  // Type / interface declarations
  if (/^(type|interface)\s/.test(trimmed)) return true;
  // Developer logging — not customer-facing.
  if (/\bconsole\.(log|warn|error|info|debug|trace)\s*\(/.test(trimmed)) return true;
  // AI prompts to the LLM — internal, not rendered as copy.
  if (/^\s*(const|let|var)\s+prompt\s*=/.test(trimmed)) return true;
  if (/^\s*`You are\b/.test(trimmed)) return true;
  return false;
}

// Strip line-trailing // comments. Block comments are stripped
// globally at the file level so multi-line /* ... */ blocks are
// handled correctly.
function stripComments(line) {
  let out = line;
  const slashIdx = out.indexOf("//");
  if (slashIdx >= 0) {
    const before = out.slice(0, slashIdx);
    const quotes = (before.match(/["'`]/g) || []).length;
    if (quotes % 2 === 0) out = before;
  }
  return out;
}

// Replace every char inside /* ... */ with a space (preserving
// newlines) so block comments evaporate but line numbers still
// match the original file.
function blankBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

// JSX/string content heuristic: does this line look like it
// contains user-visible English text? We check for two or more
// consecutive word characters separated by a space, embedded in
// either a JSX text node or a string literal.
function hasDisplayText(line) {
  return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(line);
}

// ---------------------------------------------------------------------------
// 4. Walker.
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
    } else if (ALLOWED_EXT.has(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function shouldScan(path) {
  const norm = "/" + relative(REPO_ROOT, path).replace(/\\/g, "/");
  for (const frag of EXCLUDE_PATH_FRAGMENTS) {
    if (norm.includes(frag)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 5. Rule evaluation per line.
// ---------------------------------------------------------------------------

const EM_DASH = "—"; // —
const EN_DASH = "–"; // –

function lineHasApprovedCompound(lowered) {
  for (const c of APPROVED_COMPOUNDS) {
    if (lowered.includes(c)) return true;
  }
  return false;
}

function checkLine(line) {
  const issues = [];
  if (isCodeLine(line)) return issues;
  const scanned = stripComments(line);
  if (!scanned.trim()) return issues;
  if (!hasDisplayText(scanned)) {
    // Even non-prose lines should not contain em/en dashes in
    // user-visible JSX text. But if there is no English prose at
    // all (pure JSX structural line), skip.
    return issues;
  }
  const lowered = scanned.toLowerCase();
  const hasApproved = lineHasApprovedCompound(lowered);

  // Em dash
  if (scanned.includes(EM_DASH)) {
    issues.push({ rule: "em-dash", detail: "contains em dash (—)" });
  }
  // En dash
  if (scanned.includes(EN_DASH)) {
    issues.push({ rule: "en-dash", detail: "contains en dash (–)" });
  }
  // Repeated " - " separators (three or more chunks separated by " - ")
  const dashSeparatedChunks = scanned.split(/\s[-]\s/);
  if (dashSeparatedChunks.length >= 4) {
    issues.push({ rule: "dash-separators", detail: "three or more ' - ' separators" });
  }

  // Banned phrases
  for (const phrase of BANNED_PHRASES) {
    if (lowered.includes(phrase.toLowerCase())) {
      issues.push({ rule: "banned-phrase", detail: `phrase "${phrase}"` });
    }
  }
  // Banned words (whole word)
  for (const w of BANNED_WORDS) {
    if (hasApproved && w.includes("-")) continue;
    const re = new RegExp(`(^|[^A-Za-z-])${escapeRe(w)}([^A-Za-z-]|$)`, "i");
    if (re.test(scanned)) {
      issues.push({ rule: "banned-word", detail: `word "${w}"` });
    }
  }
  // Soft banned words: only flag when inside JSX text content,
  // i.e. between > and < on the same line, or inside a quoted
  // string assigned to a display prop (title, desc, label, copy,
  // children, headline, subtitle).
  for (const w of SOFT_BANNED_WORDS) {
    const wordRe = new RegExp(`(^|[^A-Za-z-])${escapeRe(w)}([^A-Za-z-]|$)`, "i");
    if (!wordRe.test(scanned)) continue;
    if (isDisplayContext(scanned)) {
      issues.push({ rule: "banned-word", detail: `word "${w}"` });
    }
  }
  return issues;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Detect lines where the matched word appears inside JSX text or
// a "display-y" string prop. We're deliberately conservative.
function isDisplayContext(line) {
  // JSX text node: pattern `>WORD<` or `> ... WORD ... <`
  if (/>[^<>]*\b(unlock(s|ed|ing)?)\b[^<>]*</i.test(line)) return true;
  // String prop on a marketing data object
  if (/(title|desc|label|copy|headline|subtitle|tagline|cta|body|text|heading|note)\s*:\s*["'`][^"'`]*\bunlock/i.test(line)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 6. Main.
// ---------------------------------------------------------------------------

function main() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(join(REPO_ROOT, dir), files);
  }
  const targets = files.filter(shouldScan);

  let totalIssues = 0;
  const fileIssues = [];

  for (const file of targets) {
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = blankBlockComments(content).split("\n");
    const perFile = [];
    lines.forEach((line, idx) => {
      const issues = checkLine(line);
      for (const issue of issues) {
        perFile.push({ line: idx + 1, ...issue, text: line.trim() });
      }
    });
    if (perFile.length > 0) {
      fileIssues.push({ file, issues: perFile });
      totalIssues += perFile.length;
    }
  }

  if (totalIssues === 0) {
    console.log(`check-human-copy: scanned ${targets.length} files, no issues.`);
    process.exit(0);
  }

  console.error(`check-human-copy: ${totalIssues} issue(s) across ${fileIssues.length} file(s):\n`);
  for (const { file, issues } of fileIssues) {
    const rel = relative(REPO_ROOT, file);
    console.error(`  ${rel}`);
    for (const i of issues) {
      const snippet = i.text.length > 140 ? i.text.slice(0, 137) + "..." : i.text;
      console.error(`    L${i.line}  [${i.rule}] ${i.detail}`);
      console.error(`           ${snippet}`);
    }
    console.error("");
  }
  process.exit(1);
}

main();
