#!/usr/bin/env node
/**
 * check-fk-embed-disambiguation.mjs
 *
 * Guards against the FK-ambiguity regression that took prod down
 * between #341 and #343:
 *
 *   PGRST201: Could not embed because more than one relationship
 *   was found for 'projects' and 'business_profiles'
 *     Try: 'business_profiles!projects_business_profile_id_fkey' (many-to-one)
 *          'business_profiles!business_profiles_project_id_fkey' (one-to-many)
 *
 * The bare embed `business_profiles(...)` is ambiguous and PostgREST
 * rejects the whole query. Every PostgREST embed of business_profiles
 * MUST specify a relationship hint so it picks the right side.
 *
 * Today only one direction is correct for our reads (many-to-one via
 * projects.business_profile_id), so we enforce that hint specifically.
 * If a future feature legitimately wants the other direction it can
 * extend the allow-list below — but the bare form must never ship.
 *
 * Scope: backend/api/routes/*.py only. Migrations, docs, and tests
 * are not PostgREST consumers.
 *
 * Run with: npm run check:fk-embed
 * Exit code is non-zero when any bare embed is found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SCAN_DIR = join(REPO_ROOT, "backend", "api", "routes");

// Recognised FK hints. Add to this list ONLY if a future read
// legitimately needs the reverse direction.
const ALLOWED_HINTS = [
  "projects_business_profile_id_fkey",
];

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
    if (st.isDirectory()) walk(full, out);
    else if (full.endsWith(".py")) out.push(full);
  }
  return out;
}

// Match any reference to the business_profiles relation inside a
// PostgREST embed select. We then look at the character immediately
// after `business_profiles` — `(` is the ambiguous form; `!` starts
// the disambiguator.
const EMBED_TOKEN = /business_profiles([(!])/g;

const failures = [];
for (const file of walk(SCAN_DIR)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, idx) => {
    // Skip Python comments outright — guard targets executable embeds.
    const code = line.replace(/#.*$/, "");
    let m;
    EMBED_TOKEN.lastIndex = 0;
    while ((m = EMBED_TOKEN.exec(code)) !== null) {
      if (m[1] === "(") {
        failures.push({
          file: relative(REPO_ROOT, file),
          line: idx + 1,
          text: line.trim(),
          reason: "bare embed (missing FK hint)",
        });
      } else if (m[1] === "!") {
        // Disambiguated — verify the hint that follows is allowed.
        const after = code.slice(m.index + "business_profiles!".length);
        const hintMatch = /^([A-Za-z0-9_]+)/.exec(after);
        const hint = hintMatch ? hintMatch[1] : "";
        if (!ALLOWED_HINTS.includes(hint)) {
          failures.push({
            file: relative(REPO_ROOT, file),
            line: idx + 1,
            text: line.trim(),
            reason: `unknown FK hint "${hint}" (allow-list: ${ALLOWED_HINTS.join(", ")})`,
          });
        }
      }
    }
  });
}

if (failures.length === 0) {
  console.log(
    `check-fk-embed-disambiguation: scanned backend/api/routes/, no bare or unknown business_profiles embeds.`,
  );
  process.exit(0);
}

console.error(
  `check-fk-embed-disambiguation: ${failures.length} issue(s) found.\n`,
);
console.error(
  `Every PostgREST embed of business_profiles must use the FK hint, e.g.:`,
);
console.error(
  `  business_profile:business_profiles!projects_business_profile_id_fkey(...)`,
);
console.error(
  `Without it, PGRST201 fires in prod (see hotfix PR #343) and the endpoint\n` +
    `try/except path returns empty data — silently emptying the discover feed\n` +
    `and 503-ing the storefront. This guard fails CI before that ships.\n`,
);
for (const f of failures) {
  console.error(`  ${f.file}:${f.line}  [${f.reason}]`);
  const snippet = f.text.length > 140 ? f.text.slice(0, 137) + "..." : f.text;
  console.error(`    ${snippet}`);
}
process.exit(1);
