/**
 * Discover location helpers — "Near me" distance + city filtering.
 *
 * These read OPTIONAL location fields (city / latitude / longitude) off a
 * project/storefront object. Those fields are populated once the draft
 * migration adding them to business_profiles is applied AND the discover
 * feed selects them; until then the helpers see `undefined` and every
 * function degrades gracefully (no city options, no distance filtering),
 * so the discover page never breaks on missing location data.
 */

export type LatLng = { lat: number; lng: number };

/** Read validated coordinates off a project, or null when absent/invalid. */
export function getCoords(p: Record<string, unknown> | null | undefined): LatLng | null {
  if (!p) return null;
  const lat = Number((p as { latitude?: unknown }).latitude);
  const lng = Number((p as { longitude?: unknown }).longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  return null;
}

/** Read a non-empty city string off a project, or null. */
export function getCity(p: Record<string, unknown> | null | undefined): string | null {
  const c = String((p as { city?: unknown })?.city ?? "").trim();
  return c.length ? c : null;
}

/** Great-circle distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distinct, display-cased city names present across the projects. */
export function availableCities(projects: Array<Record<string, unknown>>): string[] {
  const byLower = new Map<string, string>();
  for (const p of projects) {
    const c = getCity(p);
    if (c) byLower.set(c.toLowerCase(), c);
  }
  return Array.from(byLower.values()).sort((a, b) => a.localeCompare(b));
}

/** How many of the projects carry usable coordinates. */
export function countWithCoords(projects: Array<Record<string, unknown>>): number {
  return projects.reduce((n, p) => n + (getCoords(p) ? 1 : 0), 0);
}

export type LocationFilter = {
  city: string | null;
  near: { center: LatLng; radiusMiles: number } | null;
};

/**
 * Apply city + "near me" filtering. Generic so callers keep their element
 * type. Graceful degradation rules:
 *   - city: exact case-insensitive match; projects without a city drop out
 *     only when a city filter is active.
 *   - near: distance filter applies only to projects WITH coordinates,
 *     sorted nearest-first. If NONE of the candidates have coordinates we
 *     return the set unchanged rather than blank the page.
 */
export function applyLocationFilter<T extends Record<string, unknown>>(
  projects: T[],
  f: LocationFilter,
): T[] {
  let out = projects;

  if (f.city) {
    const target = f.city.toLowerCase();
    out = out.filter((p) => (getCity(p) || "").toLowerCase() === target);
  }

  if (f.near) {
    if (countWithCoords(out) === 0) return out; // nobody has shared a location yet
    const { center, radiusMiles } = f.near;
    out = out
      .map((p) => {
        const c = getCoords(p);
        return { p, d: c ? haversineMiles(center, c) : Infinity };
      })
      .filter((x) => x.d <= radiusMiles)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.p);
  }

  return out;
}
