import Link from "next/link";

import { Badge, docTypeTone, statusTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { DocumentSummary } from "@/lib/types";

export function DocumentTable({ documents }: { documents: DocumentSummary[] }) {
  if (documents.length === 0) {
    return (
      <div className="panel p-6">
        <EmptyState
          glyph="❐"
          title="No documents in the library"
          body="Upload your first document from the dashboard to populate this view."
        />
      </div>
    );
  }

  return (
    <div className="panel-accent overflow-hidden p-0">
      <div className="grid grid-cols-12 border-b border-white/[0.06] bg-gunmetal-900/60 px-5 py-3">
        <div className="col-span-5 label-eyebrow">Title</div>
        <div className="col-span-2 label-eyebrow">Type</div>
        <div className="col-span-2 label-eyebrow">Aircraft</div>
        <div className="col-span-1 label-eyebrow">Pages</div>
        <div className="col-span-2 label-eyebrow text-right">Status</div>
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {documents.map((d) => (
          <li
            key={d.id}
            className="grid grid-cols-12 items-center px-5 py-4 text-[13px] transition hover:bg-white/[0.025]"
          >
            <div className="col-span-5 min-w-0 pr-4">
              <Link
                href={`/library/${d.id}`}
                className="block truncate font-medium text-ink-100 transition hover:text-cyan-200"
              >
                {d.title}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400">
                <span className="mono-meta">{d.id}</span>
                {d.tags.slice(0, 3).map((t) => (
                  <span key={t} className="pill">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              <Badge tone={docTypeTone(d.type)}>{d.type}</Badge>
            </div>
            <div className="col-span-2 truncate text-ink-200">
              {d.aircraft ?? "—"}
            </div>
            <div className="col-span-1 font-mono text-ink-300">
              {d.pages ?? "—"}
            </div>
            <div className="col-span-2 flex justify-end">
              <Badge tone={statusTone(d.status)} dot>
                {d.status}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
