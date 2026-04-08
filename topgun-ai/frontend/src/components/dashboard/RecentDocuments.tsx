import Link from "next/link";

import { Badge, docTypeTone, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DocumentSummary } from "@/lib/types";

export function RecentDocuments({ documents }: { documents: DocumentSummary[] }) {
  return (
    <Card
      title="Recent documents"
      subtitle="Most recently uploaded across the fleet"
      action={
        <Link
          href="/library"
          className="label-eyebrow text-cyan-300 hover:text-cyan-200"
        >
          Open library →
        </Link>
      }
    >
      {documents.length === 0 ? (
        <EmptyState
          glyph="❐"
          title="No documents yet"
          body="Drop a PDF in the upload card to populate this list."
        />
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {documents.slice(0, 5).map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <Link
                  href={`/library/${d.id}`}
                  className="block truncate text-[13px] font-medium text-ink-100 transition hover:text-cyan-200"
                >
                  {d.title}
                </Link>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-400">
                  <Badge tone={docTypeTone(d.type)}>{d.type}</Badge>
                  {d.aircraft && (
                    <span className="truncate">{d.aircraft}</span>
                  )}
                  <span className="text-ink-600">·</span>
                  <span className="mono-meta">{d.pages ?? "—"} pages</span>
                </div>
              </div>
              <Badge tone={statusTone(d.status)} dot>
                {d.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
