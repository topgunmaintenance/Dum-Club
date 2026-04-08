/**
 * SimulatedTokenBanner — renders a persistent, visible warning that the
 * token layer on this surface is a simulation, not a real on-chain market.
 *
 * Rendering rules:
 *  - Not dismissible.
 *  - Sits above the content it is labeling (not a toast, not a tooltip).
 *  - Amber/yellow accent so it is distinguishable from success/error styling.
 *  - Single-line default; wraps to two lines on narrow viewports.
 *
 * Usage:
 *   <SimulatedTokenBanner />
 *   <SimulatedTokenBanner variant="compact" />
 */

type Props = {
  /** "default" for full Exchange tab / token surfaces; "compact" for inline cards. */
  variant?: "default" | "compact";
};

export function SimulatedTokenBanner({ variant = "default" }: Props) {
  if (variant === "compact") {
    return (
      <div
        role="note"
        aria-label="Simulated token notice"
        className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200"
      >
        <span className="font-bold uppercase tracking-[0.15em] text-amber-300">Demo</span>
        <span className="text-amber-200/90">
          Simulated token — ledger-only price, no on-chain trading.
        </span>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Simulated token notice"
      className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-[12px] text-amber-100"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-[10px] font-bold text-amber-300">
          !
        </div>
        <div className="flex-1 leading-relaxed">
          <div className="font-bold uppercase tracking-[0.18em] text-amber-300">
            Demo token — simulated market
          </div>
          <div className="mt-1 text-amber-100/90">
            Price, market cap, volume, and buy/sell here are a DUM Club in-app
            ledger for demand-testing. No real tokens are minted. No on-chain
            liquidity. No real trades. When on-chain minting ships, this
            project can migrate to a live token.
          </div>
        </div>
      </div>
    </div>
  );
}
