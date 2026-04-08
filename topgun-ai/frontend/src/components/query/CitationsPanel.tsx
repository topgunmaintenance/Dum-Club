import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Citation } from "@/lib/types";

const LANE_TONE: Record<Citation["lane"], BadgeTone> = {
  manual: "cyan",
  history: "emerald",
  parts: "violet",
  pattern: "rose",
};

export function CitationsPanel({ citations }: { citations: Citation[] }) {
  return (
    <Card
      title="Citations"
      subtitle="Chunk-level source evidence"
      action={
        citations.length > 0 ? (
          <span className="pill">{citations.length} sources</span>
        ) : null
      }
    >
      {citations.length === 0 ? (
        <EmptyState
          glyph="∅"
          title="No evidence retrieved"
          body="Topgun AI refuses to answer without cited sources. Upload a relevant manual or record and ask again."
        />
      ) : (
        <ul className="space-y-3">
          {citations.map((c, idx) => (
            <li
              key={`${c.document_id}-${c.page}-${idx}`}
              className="group cursor-pointer rounded-xl border border-white/[0.06] bg-gunmetal-900/60 p-4 transition hover:border-cyan-500/30 hover:bg-gunmetal-900/80"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={LANE_TONE[c.lane]}>lane · {c.lane}</Badge>
                    <Badge tone="neutral">{c.document_type}</Badge>
                    <span className="mono-meta">p. {c.page}</span>
                  </div>
                  <div className="mt-2 truncate text-[13px] font-medium text-ink-100">
                    {c.document_title}
                  </div>
                  <blockquote className="mt-2 border-l-2 border-white/10 pl-3 text-[12px] italic leading-relaxed text-ink-300 group-hover:border-cyan-500/50">
                    {c.snippet}
                  </blockquote>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="font-mono text-[12px] text-cyan-300">
                    {c.score.toFixed(2)}
                  </div>
                  <div className="label-eyebrow">score</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
