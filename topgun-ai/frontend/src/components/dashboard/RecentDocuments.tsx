import Link from "next/link";

import { Badge, docTypeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { DocumentSummary } from "@/lib/types";

export function RecentDocuments({ documents }: { documents: DocumentSummary[] }) {
  return (
    <Card
      title="Recent documents"
      subtitle="Most recently uploaded across the fleet"
      action={
        <Link
          href="/library"
          className="text-[11px] uppercase tracking-[0.18em] text-cyan-300 hover:text-cyan-200"
        >
          Open library →
        </Link>
      }
    >
      <ul className="divide-y divide-white/5">
        {documents.slice(0, 5).map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between py-3 text-[13px]"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-ink-100">{d.title}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
                <Badge tone={docTypeTone(d.type)}>{d.type}</Badge>
                {d.aircraft && <span>{d.aircraft}</span>}
                <span>·</span>
                <span>{d.pages ?? "—"} pages</span>
              </div>
            </div>
            <Badge
              tone={d.status === "indexed" ? "emerald" : "amber"}
              className="shrink-0"
            >
              {d.status}
            </Badge>
          </li>
        ))}
      </ul>
    </Card>
  );
}
