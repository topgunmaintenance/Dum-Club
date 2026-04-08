import type { ConfidenceReport } from "@/lib/types";

const TONE_RING: Record<ConfidenceReport["label"], string> = {
  high: "from-emerald-400 to-cyan-400",
  medium: "from-cyan-400 to-cyan-600",
  low: "from-amber-400 to-amber-600",
  insufficient: "from-rose-500 to-rose-700",
};

const TONE_TEXT: Record<ConfidenceReport["label"], string> = {
  high: "text-emerald-300",
  medium: "text-cyan-300",
  low: "text-amber-300",
  insufficient: "text-rose-300",
};

export function ConfidenceBadge({ report }: { report: ConfidenceReport }) {
  const pct = Math.round(report.score * 100);
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-gunmetal-900/70 p-4">
      <div className="relative">
        <div
          className={`grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br ${TONE_RING[report.label]} text-gunmetal-950 shadow-glow`}
        >
          <span className="font-mono text-[13px] font-bold">{pct}</span>
        </div>
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] text-ink-400">
          score
        </span>
      </div>
      <div className="min-w-0">
        <div
          className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${TONE_TEXT[report.label]}`}
        >
          confidence · {report.label}
        </div>
        <div className="mt-1 text-[12.5px] leading-snug text-ink-200">
          {report.reason}
        </div>
      </div>
    </div>
  );
}
