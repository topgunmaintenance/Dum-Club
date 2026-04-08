import { AppShell } from "@/components/layout/AppShell";
import { DocumentTable } from "@/components/library/DocumentTable";
import { LibraryFilters } from "@/components/library/LibraryFilters";
import { safeListDocuments } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const list = await safeListDocuments();
  const indexed = list.documents.filter((d) => d.status === "indexed").length;
  const processing = list.documents.filter(
    (d) => d.status === "processing",
  ).length;

  return (
    <AppShell subtitle="Document Library">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="pill mb-3">Library</div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em] text-ink-100 md:text-[38px]">
            Every document in one auditable place.
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-300">
            Manuals, parts catalogs, work orders, logbooks, bulletins, and
            scans — searchable, filterable, and tagged by aircraft.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill">{list.total} documents</span>
          <span className="pill-emerald">{indexed} indexed</span>
          {processing > 0 && (
            <span className="pill-amber">{processing} processing</span>
          )}
        </div>
      </header>

      <div className="space-y-4">
        <LibraryFilters />
        <DocumentTable documents={list.documents} />
      </div>
    </AppShell>
  );
}
