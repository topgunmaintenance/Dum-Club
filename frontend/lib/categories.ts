/**
 * Shared category taxonomy + classifier.
 *
 * Used by both the homepage (frontend/app/page.tsx) and the discover
 * page (frontend/app/discover/page.tsx) so they agree on category
 * boundaries. Previously this lived as a named export on page.tsx
 * and was duplicated in discover/page.tsx, which broke the Next.js
 * App Router build because page files can only export `default`,
 * `generateMetadata`, and `generateStaticParams`. Moving the helper
 * here unblocks the Vercel build and eliminates the drift risk
 * between the two copies.
 */

export type CategoryId =
  | "restaurants"
  | "auto"
  | "home"
  | "aviation"
  | "beauty"
  | "pets"
  | "health"
  | "entertainment";

export type CategoryDefinition = {
  readonly key: CategoryId;
  readonly label: string;
  readonly icon: string;
};

/**
 * The 8 top-level merchant categories the homepage and /discover
 * filter bar surface. Order matters — it's the visual order of the
 * category grid and the filter pill row. Keep in sync with
 * classifyProject() below so every project is assignable to exactly
 * one of these keys.
 */
export const CATEGORIES: readonly CategoryDefinition[] = [
  { key: "restaurants",   label: "Food & Dining",  icon: "🍕" },
  { key: "auto",          label: "Auto Services",  icon: "🚗" },
  { key: "home",          label: "Home Services",  icon: "🏠" },
  { key: "aviation",      label: "Aviation",       icon: "✈️" },
  { key: "beauty",        label: "Beauty",         icon: "💇" },
  { key: "pets",          label: "Pets",           icon: "🐕" },
  { key: "health",        label: "Health",         icon: "🏋️" },
  { key: "entertainment", label: "Entertainment",  icon: "🎭" },
] as const;

/**
 * Keyword-based project categorizer. Scans title + name + description +
 * category + template_type fields for category-specific keywords and
 * returns the first match. "home" is the default bucket — most service
 * businesses land there absent stronger signals.
 *
 * Topgun Maintenance LLC lands in "aviation" via the
 * aircraft|avionics|pilot|drone|hangar|far-91 keyword match.
 *
 * Takes `any` rather than a strict Project type because the two
 * callers (page.tsx public projects list, discover/page.tsx Project
 * type) have different locally-defined shapes. Strict typing would
 * require a shared Project type refactor, which is out of scope for
 * this build fix.
 */
export function classifyProject(project: any): CategoryId {
  const source = `${project?.title || ""} ${project?.name || ""} ${project?.description || ""} ${project?.category || ""} ${project?.template_type || ""}`.toLowerCase();
  if (/\b(aircraft|aviation|avionics|pilot|drone|hangar|airport|helicopter|airplane|plane|far\s*91|far\s*part)/.test(source)) return "aviation";
  if (/\b(restaurant|pizza|food|cafe|diner|bakery|bar|grill|kitchen|menu|chef|sushi|taco|burger)/.test(source)) return "restaurants";
  if (/\b(auto|car|mechanic|oil\s*change|detailing|tire|transmission|brake|wash|body\s*shop)/.test(source)) return "auto";
  if (/\b(hvac|plumb|electric|roof|landscap|lawn|cleaning|handyman|painter|carpentry|contractor|home\s*repair|garden)/.test(source)) return "home";
  if (/\b(salon|barber|hair|nails|spa|massage|makeup|waxing|lashes|beauty|skincare)/.test(source)) return "beauty";
  if (/\b(pet|dog|cat|grooming|vet|kennel|walking|boarding|aquarium)/.test(source)) return "pets";
  if (/\b(fitness|gym|yoga|pilates|trainer|nutrition|wellness|therap|clinic|dental|chiropract|medical)/.test(source)) return "health";
  if (/\b(photograph|music|dj|band|comedy|art|gallery|theater|event|wedding|party|entertain|gaming|tattoo)/.test(source)) return "entertainment";
  return "home";
}
