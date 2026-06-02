/**
 * merchantState.ts — single source of truth for "what step is this
 * merchant on, and what should they do next?"
 *
 * Replaces the seven ad-hoc booleans (`isFullyOnboarded`,
 * `needsFirstOffer`, `hasOffer`, `stripeVerified`, `bizProfile`,
 * `analytics`, `merchant`) that the dashboard, merchant page, and
 * project owner-view all derived independently — and disagreed about.
 *
 * Four merchant lifecycle states, plus four pre-merchant onboarding
 * steps that block reaching State 1:
 *
 *   STATE 1 — new            (verified Stripe + business profile,
 *                              no offers)
 *   STATE 2 — first_offer    (has at least one offer, no paid sales)
 *   STATE 3 — first_sale     (has at least one paid order)
 *   STATE 4 — power_seller   (≥ POWER_SELLER_ORDERS_THRESHOLD paid
 *                              orders OR ≥ POWER_SELLER_GMV_USD)
 *
 * The pre-merchant blockers (sign in, create merchant row, connect
 * Stripe, complete business profile) all map to "STATE 1" with the
 * Next Step pointing at the appropriate gate. We do NOT define
 * separate states for those — they're transient and the consuming UI
 * only cares about (a) what to render and (b) what the next action
 * is. Both are captured in `nextAction`.
 *
 * This module is pure — no fetches, no side effects. The consumer
 * is responsible for feeding it the inputs from whichever endpoints
 * the page already calls.
 */

export type MerchantLifecycleState =
  | "new"           // STATE 1 — has merchant + verified Stripe, no offers
  | "first_offer"   // STATE 2 — has offer, no sales
  | "first_sale"    // STATE 3 — has at least one paid order
  | "power_seller"; // STATE 4 — high-volume seller

/** Power-seller thresholds. Tunable. Either condition flips a merchant
 *  into State 4. */
export const POWER_SELLER_ORDERS_THRESHOLD = 10;
export const POWER_SELLER_GMV_USD = 500;

/** The atomic next-step a merchant can be on at any moment. Ordered
 *  by lifecycle position. */
export type MerchantStep =
  | "sign_in"          // not authenticated
  | "create_merchant"  // signed in, no merchants row
  | "connect_stripe"   // merchant row exists, stripe_connect_status != 'verified'
  | "complete_profile" // verified Stripe, no business_profile
  | "create_offer"     // STATE 1 — no offers yet
  | "share_shop"       // STATE 2 — has offer, primary action is share / go live
  | "repeat_sell"      // STATE 3 — has a sale, primary action is add another offer / go live again
  | "grow";            // STATE 4 — power seller, primary action is analytics + growth

export type MerchantAction = {
  label: string;
  href: string;
  /** When false, the consumer may render this as a secondary CTA. */
  primary?: boolean;
};

export type MerchantState = {
  step: MerchantStep;
  lifecycleState: MerchantLifecycleState;
  /** True for steps the merchant has already cleared, in declared
   *  order. The consuming UI uses this to render checkmarks. */
  completed: MerchantStep[];
  /** The single most important next action. */
  nextAction: MerchantAction;
  /** Optional secondary action (e.g., State 2 → primary "Share Shop",
   *  secondary "Go Live"). */
  secondaryAction?: MerchantAction;
  /** Human-readable headline shown above the action button.
   *  Examples: "Add your first offer", "Share your shop link". */
  headline: string;
  /** One-sentence supporting copy. */
  subhead: string;
};

export type MerchantStateInputs = {
  /** Privy-authenticated user present. */
  isAuthenticated: boolean;
  /** True when a row exists in `merchants` for this user. */
  hasMerchant: boolean;
  /** Stripe Connect status from merchants.stripe_connect_status.
   *  "verified" is the only state that unblocks taking payments;
   *  "connected" means OAuth completed but Stripe is still reviewing. */
  stripeStatus: string | null;
  /** True when a row exists in `business_profiles` for this user. */
  hasBusinessProfile: boolean;
  /** True when ≥ 1 project exists (the storefront row).
   *  The auto-create path (#305-309) usually means this is true the
   *  moment hasMerchant is true; but a brand-new signup or a backfill
   *  miss can leave it false transiently. */
  hasProject: boolean;
  /** Total number of offers across the merchant's projects. */
  offerCount: number;
  /** Number of paid orders. Use orders.status='paid' count. */
  salesCount: number;
  /** Gross merchandise volume in USD across all paid orders.
   *  Used for the power-seller threshold. */
  gmvUsd: number;
  /** Slug or id of the primary project, used to build storefront /
   *  composer / go-live URLs. */
  primaryProjectSlug?: string | null;
};

/** Pure function: produce the merchant's current state + next action
 *  from the inputs. No fetches. */
export function deriveMerchantState(inputs: MerchantStateInputs): MerchantState {
  const {
    isAuthenticated, hasMerchant, stripeStatus, hasBusinessProfile,
    hasProject, offerCount, salesCount, gmvUsd, primaryProjectSlug,
  } = inputs;

  // ── Pre-merchant onboarding gates ───────────────────────────
  if (!isAuthenticated) {
    return {
      step: "sign_in",
      lifecycleState: "new",
      completed: [],
      headline: "Sign in to start selling",
      subhead: "Use your email or phone — no password needed.",
      nextAction: { label: "Sign in", href: "/merchant", primary: true },
    };
  }

  if (!hasMerchant) {
    return {
      step: "create_merchant",
      lifecycleState: "new",
      completed: ["sign_in"],
      headline: "Create your shop",
      subhead: "Name your business and pick a tier. Takes one minute.",
      nextAction: { label: "Create my shop", href: "/merchant", primary: true },
    };
  }

  const stripeVerified = stripeStatus === "verified";
  // The "connected" but not yet "verified" state — OAuth ran but Stripe
  // hasn't finished review. The merchant can still configure offers, but
  // can't take payments yet. We surface this as a separate step so the
  // UI can say "Stripe is still reviewing" rather than implying nothing
  // happened.
  if (!stripeVerified) {
    const stripeConnected = stripeStatus === "connected";
    return {
      step: "connect_stripe",
      lifecycleState: "new",
      completed: ["sign_in", "create_merchant"],
      headline: stripeConnected ? "Stripe is reviewing your account" : "Connect Stripe to take payments",
      subhead: stripeConnected
        ? "We notify you the moment Stripe approves you. You can keep setting up your shop in the meantime."
        : "Customers pay you directly. Stripe deposits the money in your bank.",
      nextAction: stripeConnected
        ? { label: "Continue setting up", href: "/merchant", primary: true }
        : { label: "Connect Stripe", href: "/merchant", primary: true },
    };
  }

  if (!hasBusinessProfile) {
    return {
      step: "complete_profile",
      lifecycleState: "new",
      completed: ["sign_in", "create_merchant", "connect_stripe"],
      headline: "Tell customers about your business",
      subhead: "A short description and a category. Two minutes, tops.",
      nextAction: { label: "Complete profile", href: "/merchant#profile", primary: true },
    };
  }

  // ── State 1: ready to create first offer ────────────────────
  // Note: hasProject is checked alongside offerCount === 0 because the
  // auto-create from #305-309 makes hasProject = true once the merchant
  // exists, but a backfill miss could leave hasProject = false. Either
  // case = needs an offer.
  if (offerCount === 0 || !hasProject) {
    return {
      step: "create_offer",
      lifecycleState: "new",
      completed: ["sign_in", "create_merchant", "connect_stripe", "complete_profile"],
      headline: "Add your first offer",
      subhead: "Pick one thing you sell and set a price. That's all you need to start selling.",
      nextAction: { label: "Create Your First Offer", href: "/dashboard/post", primary: true },
    };
  }

  // ── State 2: has offers, no paid sales ──────────────────────
  if (salesCount === 0) {
    const shopUrl = primaryProjectSlug ? `/project/${primaryProjectSlug}` : "/dashboard";
    return {
      step: "share_shop",
      lifecycleState: "first_offer",
      completed: ["sign_in", "create_merchant", "connect_stripe", "complete_profile", "create_offer"],
      headline: "Share your shop with your first customer",
      subhead: "Text the link to someone who'd buy. Your first sale unlocks the rest of the dashboard.",
      nextAction: { label: "Share Shop", href: shopUrl, primary: true },
      secondaryAction: primaryProjectSlug
        ? { label: "Go Live", href: `/project/${primaryProjectSlug}?golive=1` }
        : undefined,
    };
  }

  // ── State 4: power seller ───────────────────────────────────
  // Either threshold flips it. Order matters: we check power_seller
  // BEFORE first_sale so a merchant at the threshold sees the
  // power-seller UI, not the basic "first sale" UI.
  if (salesCount >= POWER_SELLER_ORDERS_THRESHOLD || gmvUsd >= POWER_SELLER_GMV_USD) {
    return {
      step: "grow",
      lifecycleState: "power_seller",
      completed: ["sign_in", "create_merchant", "connect_stripe", "complete_profile", "create_offer", "share_shop", "repeat_sell"],
      headline: "Grow your sales",
      subhead: "Your shop is humming. See what's working and double down.",
      nextAction: { label: "View Analytics", href: "/dashboard#analytics", primary: true },
      secondaryAction: { label: "Grow Sales", href: "/dashboard/post" },
    };
  }

  // ── State 3: first sale, sub-power-seller ───────────────────
  const shopUrl = primaryProjectSlug ? `/project/${primaryProjectSlug}` : "/dashboard";
  return {
    step: "repeat_sell",
    lifecycleState: "first_sale",
    completed: ["sign_in", "create_merchant", "connect_stripe", "complete_profile", "create_offer", "share_shop"],
    headline: "Keep the momentum",
    subhead: "Add another offer or go live again — that's how merchants stack sales.",
    nextAction: { label: "Add Offer", href: "/dashboard/post", primary: true },
    secondaryAction: primaryProjectSlug
      ? { label: "Go Live Again", href: `${shopUrl}?golive=1` }
      : undefined,
  };
}

/** Human-readable label for each step. Used by checklist UIs. */
export function stepLabel(step: MerchantStep): string {
  switch (step) {
    case "sign_in":          return "Sign in";
    case "create_merchant":  return "Create your shop";
    case "connect_stripe":   return "Connect Stripe";
    case "complete_profile": return "Complete business profile";
    case "create_offer":     return "Add your first offer";
    case "share_shop":       return "Share your shop";
    case "repeat_sell":      return "Add another offer";
    case "grow":             return "Grow your sales";
  }
}
