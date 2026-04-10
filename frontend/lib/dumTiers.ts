/**
 * Canonical DUM tier definitions — single source of truth.
 * Import this everywhere tiers are displayed.
 */

export type DumTier = {
  name: string;
  min: number;
  color: string;
};

export const TIERS: DumTier[] = [
  { name: "Starter", min: 0, color: "#666" },
  { name: "Builder", min: 50, color: "#00FF87" },
  { name: "Operator", min: 100, color: "#F5A623" },
  { name: "Major", min: 1000, color: "#4F9EFF" },
];

export function getTier(pts: number): DumTier {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (pts >= TIERS[i].min) return TIERS[i];
  }
  return TIERS[0];
}

export function getNextTier(pts: number): DumTier | null {
  for (const t of TIERS) {
    if (pts < t.min) return t;
  }
  return null;
}
