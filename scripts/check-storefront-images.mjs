#!/usr/bin/env node
/**
 * check-storefront-images.mjs
 *
 * Fails CI if any RELATIVE image path referenced from rendered
 * frontend code is missing from frontend/public/. Catches the
 * failure mode where a new `/images/foo.jpg` reference lands in
 * JSX without the file being added under frontend/public/.
 *
 * Scope:
 *   - frontend/app, frontend/components, frontend/lib  (rendered)
 *
 * Intentionally NOT scanned:
 *   - backend/db/migrations/*.sql  — seed data; production rewrites
 *     image URLs to absolute external originals (see migration
 *     033_topgun_image_urls_absolute.sql). Local /images/topgun/*
 *     paths in 031 are overwritten by 033 in prod.
 *   - scripts/fetch-topgun-photos.sh  — contains source URLs that
 *     are external (not under frontend/public/) by design.
 *
 * Match rule: a path of the form /images/.../<file>.<ext> that is
 * NOT inside an absolute http(s):// URL (those resolve against an
 * external host, not the Next.js public directory).
 *
 * Run with: node scripts/check-storefront-images.mjs
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const PUBLIC_DIR = join(REPO_ROOT, "frontend", "public");

const SCAN_DIRS = [
  join(REPO_ROOT, "frontend", "app"),
  join(REPO_ROOT, "frontend", "components"),
  join(REPO_ROOT, "frontend", "lib"),
];

const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Capture every /images/... path that ISN'T preceded by an
// http(s):// or //host scheme. The negative lookbehind keeps the
// match local-only.
const IMAGE_RE = /(?<!https?:)(?<!\/\/[^"' )]{0,200})\/images\/[a-zA-Z0-9_\-./]+\.(?:jpe?g|png|webp|svg)/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

const referenced = new Set();
for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const text = readFileSync(file, "utf8");
    const matches = text.match(IMAGE_RE);
    if (!matches) continue;
    for (const raw of matches) {
      const path = raw.replace(/[,'";)]+$/g, "");
      referenced.add(path);
    }
  }
}

const missing = [];
for (const path of referenced) {
  const onDisk = join(PUBLIC_DIR, path.replace(/^\//, ""));
  if (!existsSync(onDisk)) missing.push(path);
}

if (missing.length > 0) {
  console.error(
    `check-storefront-images: ${missing.length} referenced image(s) missing from frontend/public/`,
  );
  for (const p of missing.sort()) {
    console.error(`  - ${p}`);
  }
  console.error("");
  console.error(
    "Fix: add the missing file under frontend/public/, or convert the " +
      "reference to an absolute URL if it lives on an external CDN. " +
      "For Topgun storefront photos, scripts/fetch-topgun-photos.sh " +
      "mirrors them into frontend/public/images/topgun/.",
  );
  process.exit(1);
}

console.log(
  `check-storefront-images: scanned ${referenced.size} image reference(s), all present.`,
);
