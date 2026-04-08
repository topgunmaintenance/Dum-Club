import { AppShell } from "@/components/layout/AppShell";
import { DocumentTable } from "@/components/library/DocumentTable";
import { LibraryFilters } from "@/components/library/LibraryFilters";
import { safeListDocuments } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const list = await safeListDocuments();

  return (
    <AppShell subtitle="Document Library">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="pill mb-3">Library</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
            Every document in one auditable place.
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-ink-300">
            Manuals, parts catalogs, work orders, logbooks, bulletins, and
            scans — searchable, filterable, and tagged by aircraft.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-400">
          <span className="pill">{list.total} documents</span>
          <span className="pill-cyan">7 indexed · 1 processing</span>
        </div>
      </div>

      <div className="space-y-4">
        <LibraryFilters />
        <DocumentTable documents={list.documents} />
      </div>
    </AppShell>
  );
}
