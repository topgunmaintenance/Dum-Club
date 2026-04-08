import { Badge, docTypeTone, statusTone } from "@/components/ui/Badge";
import type { DocumentSummary } from "@/lib/types";

export function DocumentTable({ documents }: { documents: DocumentSummary[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-12 border-b border-white/5 bg-gunmetal-900/60 px-5 py-3 text-[10px] uppercase tracking-[0.2em] text-ink-400">
        <div className="col-span-5">Title</div>
        <div className="col-span-2">Type</div>
        <div className="col-span-2">Aircraft</div>
        <div className="col-span-1">Pages</div>
        <div className="col-span-2 text-right">Status</div>
      </div>
      <ul className="divide-y divide-white/5">
        {documents.map((d) => (
          <li
            key={d.id}
            className="grid grid-cols-12 items-center px-5 py-4 text-[13px] transition hover:bg-white/[0.02]"
          >
            <div className="col-span-5 min-w-0">
              <div className="truncate font-medium text-ink-100">{d.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
                <span className="font-mono">{d.id}</span>
                {d.tags.map((t) => (
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
              <Badge tone={statusTone(d.status)}>{d.status}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
