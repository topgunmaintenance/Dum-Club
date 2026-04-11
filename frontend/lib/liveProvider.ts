/**
 * Live streaming provider detection and feature flags.
 */

export const IVS_REALTIME_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_IVS_REALTIME === "true";

export type LiveProvider = "ivs_realtime" | "native_mux" | "manual_embed";

/**
 * Determine which live provider to use for "Go Live".
 * IVS Real-Time is preferred when enabled.
 */
export function getPreferredProvider(): LiveProvider {
  if (IVS_REALTIME_ENABLED) return "ivs_realtime";
  return "native_mux";
}

/**
 * Check if a project is using IVS Real-Time for its current live session.
 */
export function isIVSSession(project: { live_provider?: string | null }): boolean {
  return project.live_provider === "ivs_realtime";
}
