/**
 * Store Status card — pure decision logic for the merchant owner view
 * on /project/[id].
 *
 * A non-technical owner should understand the card in seconds: one plain
 * "next step" sentence and one obvious primary button. The owner moves
 * through exactly three states:
 *
 *   1. No offer yet        → "Add Offer"
 *   2. Has offer, not live → "Go Live"
 *   3. Live                → "Copy Store Link"
 *
 * Kept as a pure function (no React, no DOM) so it can be unit-tested in
 * isolation — see frontend/__tests__/lib/storeStatus.test.mjs. The page
 * maps `primaryAction` to the real handler (open offer form / go live /
 * copy link). There is deliberately no "Submit for Review" branch: the
 * review flow was removed.
 */

export type StorePrimaryAction = "add_offer" | "go_live" | "copy_link";

export interface StoreStatusCta {
  /** Plain-language sentence telling the owner what to do next. */
  nextStep: string;
  /** Label for the single primary button. */
  primaryLabel: string;
  /** Which real action the primary button runs. */
  primaryAction: StorePrimaryAction;
}

export function deriveStoreStatusCta(input: {
  hasOffer: boolean;
  storeIsLive: boolean;
}): StoreStatusCta {
  if (!input.hasOffer) {
    return {
      nextStep: "Add your first offer so customers can buy.",
      primaryLabel: "Add Offer",
      primaryAction: "add_offer",
    };
  }
  if (!input.storeIsLive) {
    return {
      nextStep: "Go live when you are ready to sell.",
      primaryLabel: "Go Live",
      primaryAction: "go_live",
    };
  }
  return {
    nextStep: "Your store is live. Share your link.",
    primaryLabel: "Copy Store Link",
    primaryAction: "copy_link",
  };
}
