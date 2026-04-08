import { Card } from "@/components/ui/Card";
import type { Citation } from "@/lib/types";

export function SourceDrawerPreview({
  citation,
}: {
  citation?: Citation;
}) {
  if (!citation) return null;
  return (
    <Card
      title="Source drawer"
      subtitle="Top-ranked citation · click to open in library"
      action={<span className="mono-meta">page {citation.page}</span>}
    >
      <div className="rounded-xl border border-white/[0.06] bg-gunmetal-900/70 p-4">
        <div className="flex items-center justify-between">
          <span className="label-eyebrow text-cyan-300">
            {citation.document_type}
          </span>
          <span className="font-mono text-[10px] text-cyan-300">
            {citation.score.toFixed(2)}
          </span>
        </div>
        <div className="mt-2 text-[13px] font-medium text-ink-100">
          {citation.document_title}
        </div>
        <blockquote className="mt-3 border-l-2 border-cyan-500/50 pl-3 text-[12px] italic leading-relaxed text-ink-300">
          {citation.snippet}
        </blockquote>
        <div className="mt-4 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-ink-500">
          <span>{citation.document_id}</span>
          <span>lane · {citation.lane}</span>
        </div>
      </div>
    </Card>
  );
}
