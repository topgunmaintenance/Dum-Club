import { Badge } from "@/components/ui/Badge";

export function SessionHeader({
  question,
  latencyMs,
  provider,
  citationCount,
  confidenceLabel,
}: {
  question: string;
  latencyMs: number;
  provider: string;
  citationCount: number;
  confidenceLabel: string;
}) {
  return (
    <div className="panel-accent mb-5 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="label-eyebrow text-cyan-300">Session · active</span>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-ink-400">
          <span className="mono-meta">latency · {latencyMs} ms</span>
          <span className="text-ink-600">·</span>
          <span className="mono-meta">provider · {provider}</span>
          <span className="text-ink-600">·</span>
          <span className="mono-meta">{citationCount} cites</span>
        </div>
      </div>
      <p className="mt-3 font-sans text-[15px] leading-snug text-ink-100">
        <span className="mr-2 font-mono text-cyan-400">›</span>
        {question}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone="cyan">lane · manual</Badge>
        <Badge tone="emerald">lane · history</Badge>
        <Badge
          tone={
            confidenceLabel === "high"
              ? "emerald"
              : confidenceLabel === "medium"
                ? "cyan"
                : confidenceLabel === "low"
                  ? "amber"
                  : "rose"
          }
        >
          confidence · {confidenceLabel}
        </Badge>
      </div>
    </div>
  );
}
