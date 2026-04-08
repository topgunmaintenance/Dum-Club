import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { ProcessingLogEntry } from "@/lib/types";

export function ProcessingLogs({ logs }: { logs: ProcessingLogEntry[] }) {
  return (
    <Card
      title="Recent processing"
      subtitle="Last events from the ingestion workers"
    >
      <ul className="divide-y divide-white/5 font-mono text-[12px]">
        {logs.map((entry, idx) => (
          <li
            key={`${entry.ts}-${idx}`}
            className="grid grid-cols-12 items-center gap-3 py-3"
          >
            <span className="col-span-3 text-[11px] text-ink-400">
              {entry.ts}
            </span>
            <span className="col-span-2 text-cyan-300">{entry.stage}</span>
            <span className="col-span-4 truncate text-ink-200">{entry.doc}</span>
            <div className="col-span-3 flex justify-end">
              <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
            </div>
            {entry.detail && (
              <p className="col-span-12 -mt-1 pl-[25%] text-[11px] text-ink-400">
                {entry.detail}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
