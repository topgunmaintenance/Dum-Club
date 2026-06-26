/**
 * Verb category model for /discover — EAT / FIX / MOVE / SHOP / BOOK.
 *
 * Five plain-English verbs sit on top of the existing category system. A
 * project's verb is resolved in two steps, explicit data first:
 *
 *   1. If projects.category_id is set and maps to a verb (mig 035 seed +
 *      mig 074 ids), that verb wins outright — no guessing.
 *   2. Otherwise (NULL / unmapped category_id) we fall back to the keyword
 *      classifier's 8 buckets (classifyProject), same source the old
 *      category pills used, and match on the verb's bucket set.
 *
 * This is a CODE CONSTANT, not a migration — no schema change. It reuses
 * projects.category_id and classifyProject; nothing new is stored.
 *
 * Coverage note: retail / art-handcraft (SHOP) have no classifier bucket,
 * so a SHOP merchant is only detected when it has set category_id
 * explicitly. A retail merchant that left category_id NULL classifies into
 * the keyword default ("home") and lands under FIX until it picks a
 * category. Merchants with a real category_id route correctly.
 */

import { classifyProject, type CategoryId } from "../categories";
import type { Project } from "./types";

export type VerbId = "eat" | "fix" | "move" | "shop" | "book";

export type VerbDef = {
  readonly id: VerbId;
  readonly label: string;
  readonly glyph: string;
  /** DB category_id values (mig 035 + 074) that belong to this verb. */
  readonly categoryIds: readonly string[];
  /** classifyProject() buckets that fall back to this verb when category_id
   *  is NULL or unmapped. */
  readonly buckets: readonly CategoryId[];
};

export const VERBS: readonly VerbDef[] = [
  {
    id: "eat",
    label: "Eat",
    glyph: "🍔",
    categoryIds: ["restaurants", "food-trucks", "coffee-shops", "bars"],
    buckets: ["restaurants"],
  },
  {
    id: "fix",
    label: "Fix",
    glyph: "🔧",
    categoryIds: ["auto-services", "home-services", "aviation"],
    buckets: ["auto", "home", "aviation"],
  },
  {
    id: "move",
    label: "Move",
    glyph: "🏃",
    categoryIds: ["fitness"],
    buckets: ["health"],
  },
  {
    id: "shop",
    label: "Shop",
    glyph: "🛍️",
    categoryIds: ["retail", "art-handcraft"],
    buckets: [],
  },
  {
    id: "book",
    label: "Book",
    glyph: "📅",
    categoryIds: ["beauty-services", "professional-services", "events", "pets", "entertainment"],
    buckets: ["beauty", "pets", "entertainment"],
  },
];

// /discover defaults to the "For you" (all) pill, so there's no default verb
// here anymore — the category pill row owns that (see VerbTabs).

export const VERB_IDS: readonly VerbId[] = VERBS.map((v) => v.id);

export function isVerbId(value: string | null | undefined): value is VerbId {
  return !!value && (VERB_IDS as readonly string[]).includes(value);
}

const VERBS_BY_ID: Readonly<Record<VerbId, VerbDef>> = Object.fromEntries(
  VERBS.map((v) => [v.id, v]),
) as Record<VerbId, VerbDef>;

// Reverse map: every known DB category_id → its verb. Explicit category_id
// wins over the classifier so a retail shop never leaks into FIX via the
// keyword default.
const CATEGORY_ID_TO_VERB: Readonly<Record<string, VerbId>> = Object.fromEntries(
  VERBS.flatMap((v) => v.categoryIds.map((cid) => [cid, v.id])),
) as Record<string, VerbId>;

/**
 * Does this project belong to the given verb?
 *   - category_id set + mapped → only its own verb matches.
 *   - category_id NULL/unmapped → fall back to the classifier buckets.
 */
export function projectMatchesVerb(project: Project, verb: VerbId): boolean {
  const id = ((project as { category_id?: string | null })?.category_id || "").trim();
  const mapped = id ? CATEGORY_ID_TO_VERB[id] : undefined;
  if (mapped) return mapped === verb;
  return VERBS_BY_ID[verb].buckets.includes(classifyProject(project));
}

/**
 * Human verb label for a project-like object ("Fix", "Eat", …). Used by the
 * live room's shop chip. Accepts a loose shape (the storefront's project type
 * differs from the Discover Project type) — resolution reuses
 * projectMatchesVerb, so it honors category_id first, classifier second.
 * Returns "" when nothing matches.
 */
export function verbLabelForProject(project: any): string {
  const match = VERBS.find((v) => projectMatchesVerb(project, v.id));
  return match ? match.label : "";
}
