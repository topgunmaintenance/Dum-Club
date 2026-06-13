/**
 * Frontend feature flags — single source of truth.
 *
 * Keep these as plain consts so toggling is a one-line edit and the
 * dead branch is statically obvious to readers and the bundler.
 */

// Master switch for every customer- and owner-facing AI surface:
//   - the "Grow your business with AI" owner bar
//   - the "Ask AI" buttons (pitch CTA, storefront card, the
//     "Ask AI about this business" workspace)
//   - the "Chat with <business>" AiSalesChat floating bubble
// Set to false to hide all of them at once; flip to true to restore.
// Components and their code paths are untouched — purely gated at the
// render site. NOTE: this does NOT gate GuestChat ("Message the shop"),
// which is a human merchant-inbox message, not an AI surface.
export const ENABLE_AI_FEATURES = false;
