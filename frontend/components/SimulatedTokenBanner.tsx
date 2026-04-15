/**
 * SimulatedTokenBanner — renders a "Coming Soon" notice on surfaces that
 * preview tokenized rewards. Per CLAUDE.md rule #3, tokenization and
 * on-chain features are future-phase, not current product. This banner
 * frames them accordingly instead of describing a live simulation.
 *
 * Rendering rules:
 *  - Not dismissible.
 *  - Sits above the content it is labeling (not a toast, not a tooltip).
 *  - Amber/yellow accent so it is distinguishable from success/error styling.
 *
 * Usage:
 *   <SimulatedTokenBanner />
 *   <SimulatedTokenBanner variant="compact" />
 */

type Props = {
  /** "default" for full preview surfaces; "compact" for inline cards. */
  variant?: "default" | "compact";
};

export function SimulatedTokenBanner({ variant = "default" }: Props) {
  if (variant === "compact") {
    return (
      <div
        role="note"
        aria-label="Coming soon notice"
        className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200"
      >
        <span className="font-bold uppercase tracking-[0.15em] text-amber-300">Coming Soon</span>
        <span className="text-amber-200/90">
          Tokenized rewards are a future-phase feature.
        </span>
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Coming soon notice"
      className="mb-4 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-[12px] text-amber-100"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-[10px] font-bold text-amber-300">
          !
        </div>
        <div className="flex-1 leading-relaxed">
          <div className="font-bold uppercase tracking-[0.18em] text-amber-300">
            Coming Soon — future-phase feature
          </div>
          <div className="mt-1 text-amber-100/90">
            DUM Points power discounts from Stripe purchases today. Tokenized
            rewards and on-chain features are planned for a future phase,
            subject to legal and regulatory review. Anything shown here is a
            preview of that future surface.
          </div>
        </div>
      </div>
    </div>
  );
}
