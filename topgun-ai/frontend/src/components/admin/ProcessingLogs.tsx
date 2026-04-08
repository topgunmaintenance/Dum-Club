import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ProcessingLogEntry } from "@/lib/types";

export function ProcessingLogs({ logs }: { logs: ProcessingLogEntry[] }) {
  return (
    <Card
      title="Recent processing"
      subtitle="Last events from the ingestion workers"
      action={<span className="pill">{logs.length} events</span>}
    >
      {logs.length === 0 ? (
        <EmptyState
          glyph="⌬"
          title="No recent activity"
          body="Processing events appear here as documents move through the pipeline."
        />
      ) : (
        <ul className="space-y-2">
          {logs.map((entry, idx) => (
            <li
              key={`${entry.ts}-${idx}`}
              className="rounded-lg border border-white/[0.06] bg-gunmetal-900/60 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="pill-cyan whitespace-nowrap">{entry.stage}</span>
                  <span className="truncate font-mono text-[11.5px] text-ink-200">
                    {entry.doc}
                  </span>
                </div>
                <Badge tone={statusTone(entry.status)} dot>
                  {entry.status}
                </Badge>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 text-[10.5px] text-ink-400">
                <span className="mono-meta">{entry.ts}</span>
                {entry.detail && (
                  <span className="truncate text-right">{entry.detail}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
