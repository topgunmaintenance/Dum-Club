/**
 * Token mode helper — single source of truth for "is this a simulated (SIM_)
 * token or a real on-chain token?"
 *
 * Every frontend surface that renders a per-project token MUST route through
 * this helper. Do not string-match "SIM_" in components. If you add a new
 * place that displays a mint address, price, market cap, trade button, or
 * candle chart, wire it through isSimulatedToken(...) so a future switch to
 * real on-chain tokens is a one-line change.
 *
 * DUM Points are a separate system (real Stripe on-ramp, optional on-chain
 * claim) and are out of scope. Do not call this helper for DUM Points.
 */

export type TokenMode = "simulated" | "on_chain";

/**
 * True when the mint address is missing, empty, or is a simulated placeholder.
 * The "SIM_" prefix is written by backend/api/routes/token.py and launch.py.
 */
export function isSimulatedToken(mint?: string | null): boolean {
  if (!mint) return true;
  return mint.startsWith("SIM_");
}

export function tokenMode(mint?: string | null): TokenMode {
  return isSimulatedToken(mint) ? "simulated" : "on_chain";
}

/** Short visible label for badges. "DEMO" for simulated, "LIVE" for real. */
export function tokenModeLabel(mint?: string | null): "DEMO" | "LIVE" {
  return isSimulatedToken(mint) ? "DEMO" : "LIVE";
}
