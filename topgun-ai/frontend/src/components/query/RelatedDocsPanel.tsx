import { Badge, docTypeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { DocRef } from "@/lib/types";

export function RelatedDocsPanel({ docs }: { docs: DocRef[] }) {
  return (
    <Card title="Related documents" subtitle="Suggested by retrieval lanes">
      {docs.length === 0 ? (
        <p className="text-[12px] text-ink-400">No related documents.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-gunmetal-900/60 px-3 py-2 text-[12px] transition hover:border-cyan-500/30"
            >
              <div className="min-w-0">
                <div className="truncate text-ink-100">{d.title}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-400">
                  {d.id}
                </div>
              </div>
              <Badge tone={docTypeTone(d.type)}>{d.type}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
