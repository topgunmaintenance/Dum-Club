import { Card } from "@/components/ui/Card";
import type { Citation } from "@/lib/types";

type Lane = Citation["lane"];
const LANES: Lane[] = ["manual", "history", "parts", "pattern"];
const LANE_COLOR: Record<Lane, string> = {
  manual: "from-cyan-400 to-cyan-600",
  history: "from-emerald-400 to-emerald-600",
  parts: "from-violet-400 to-violet-600",
  pattern: "from-rose-400 to-rose-600",
};

export function LaneContribution({ citations }: { citations: Citation[] }) {
  const totals: Record<Lane, number> = {
    manual: 0,
    history: 0,
    parts: 0,
    pattern: 0,
  };
  citations.forEach((c) => {
    totals[c.lane] += Math.max(c.score, 0.01);
  });
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;

  return (
    <Card
      title="Lane contribution"
      subtitle="Reciprocal rank fusion across lanes"
      action={<span className="mono-meta">RRF · weighted</span>}
    >
      <div className="grid grid-cols-4 gap-3">
        {LANES.map((lane) => {
          const pct = Math.round((totals[lane] / sum) * 100);
          return (
            <div key={lane}>
              <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-ink-400">
                <span>{lane}</span>
                <span className="font-mono text-cyan-300">{pct}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className={`h-full bg-gradient-to-r ${LANE_COLOR[lane]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
