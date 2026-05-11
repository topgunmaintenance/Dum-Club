/**
 * Merchant subscription tier helpers.
 *
 * The DB column `merchants.subscription_tier` (migration 026) is a
 * VARCHAR with values currently set to 'founding' or 'standard' by
 * the merchant signup flow (backend/api/routes/merchant.py:320,357).
 * The richer tier ladder from CLAUDE.md §3 — starter / growth / pro
 * / business / enterprise — is doctrine and is the target schema as
 * paid Stripe subscriptions come online. Helpers below already
 * recognise those values so the gate Just Works once they're
 * populated.
 *
 * Drive Your Market Analytics gate (per audit + user choice):
 *   - Founding: ✓ (founding members get all paid features free)
 *   - Growth / Pro / Business / Enterprise: ✓
 *   - Standard / Starter (or anything else): ✗ → upgrade card
 */

export type SubscriptionTier =
  | "founding"
  | "starter"
  | "standard"
  | "growth"
  | "pro"
  | "business"
  | "enterprise"
  | (string & {}); // accept future tiers without TS errors

const ANALYTICS_TIERS: ReadonlySet<string> = new Set([
  "founding",
  "growth",
  "pro",
  "business",
  "enterprise",
]);

export function hasAnalyticsAccess(
  merchant: { subscription_tier?: SubscriptionTier | null } | null | undefined,
): boolean {
  if (!merchant) return false;
  const tier = (merchant.subscription_tier || "").toString().toLowerCase();
  return ANALYTICS_TIERS.has(tier);
}
