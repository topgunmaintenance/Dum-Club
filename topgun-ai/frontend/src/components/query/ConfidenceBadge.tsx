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
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-gunmetal-900/70 p-3">
      <div
        className={`relative grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br ${TONE_RING[report.label]} text-gunmetal-950 shadow-glow`}
      >
        <span className="font-mono text-xs font-bold">{pct}</span>
      </div>
      <div className="min-w-0">
        <div
          className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${TONE_TEXT[report.label]}`}
        >
          confidence · {report.label}
        </div>
        <div className="text-[12px] text-ink-200">{report.reason}</div>
      </div>
    </div>
  );
}
