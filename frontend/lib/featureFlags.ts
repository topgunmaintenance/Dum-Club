/**
 * Customer-facing feature flags. One constant per flag so re-enabling
 * a surface is a single-line change.
 */

// Master switch for every AI surface on the storefront. When false we
// hide all of them: the owner "Grow your business with AI" bar, the
// "Ask AI" buttons + the "Ask AI about this business" workspace, and the
// floating "Chat with {business}" AI bubble. The components and their
// code paths are preserved — this only gates whether they render — so
// flipping this back to true brings every AI surface back unchanged.
export const ENABLE_AI_FEATURES = false;
