import { Badge, docTypeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DocRef } from "@/lib/types";

export function RelatedDocsPanel({ docs }: { docs: DocRef[] }) {
  return (
    <Card title="Related documents" subtitle="Suggested by retrieval lanes">
      {docs.length === 0 ? (
        <EmptyState
          glyph="❐"
          title="No related documents"
          body="Related suggestions appear when multiple sources support the same answer."
        />
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="group flex items-center justify-between rounded-lg border border-white/[0.06] bg-gunmetal-900/60 px-3 py-2.5 transition hover:border-cyan-500/30"
            >
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-medium text-ink-100">
                  {d.title}
                </div>
                <div className="mono-meta mt-0.5">{d.id}</div>
              </div>
              <Badge tone={docTypeTone(d.type)}>{d.type}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
