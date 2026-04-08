import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { Citation } from "@/lib/types";

const LANE_TONE = {
  manual: "cyan",
  history: "emerald",
  parts: "amber",
  pattern: "rose",
} as const;

export function CitationsPanel({ citations }: { citations: Citation[] }) {
  return (
    <Card
      title="Citations"
      subtitle="Source-cited evidence — chunk-level provenance"
    >
      {citations.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-gunmetal-900/60 p-4 text-[12px] text-ink-400">
          No citations attached. Topgun AI refuses to answer without
          source evidence.
        </div>
      ) : (
        <ul className="space-y-3">
          {citations.map((c, idx) => (
            <li
              key={`${c.document_id}-${c.page}-${idx}`}
              className="group rounded-xl border border-white/5 bg-gunmetal-900/60 p-3 transition hover:border-cyan-500/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={LANE_TONE[c.lane]}>{c.lane}</Badge>
                    <span className="pill">{c.document_type}</span>
                  </div>
                  <div className="mt-2 truncate text-[13px] font-medium text-ink-100">
                    {c.document_title}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-300">
                    “{c.snippet}”
                  </p>
                </div>
                <div className="text-right text-[10px] uppercase tracking-wider text-ink-400">
                  <div>page {c.page}</div>
                  <div className="font-mono text-cyan-300">
                    {c.score.toFixed(2)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
