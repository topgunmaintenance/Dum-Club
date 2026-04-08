import { AppShell } from "@/components/layout/AppShell";
import { RecentDocuments } from "@/components/dashboard/RecentDocuments";
import { RecentQueries } from "@/components/dashboard/RecentQueries";
import { StatusCards } from "@/components/dashboard/StatusCards";
import { UploadCard } from "@/components/dashboard/UploadCard";
import { Card } from "@/components/ui/Card";
import {
  safeListDocuments,
  safeRecentQueries,
  safeSystemStatus,
} from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [docList, recent, system] = await Promise.all([
    safeListDocuments(),
    safeRecentQueries(5),
    safeSystemStatus(),
  ]);

  return (
    <AppShell subtitle="Dashboard">
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="pill-cyan mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Demo operator workspace
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
            Maintenance intelligence, organized.
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-ink-300">
            Search manuals, records, and parts context instantly. Every
            answer is backed by source evidence and an explicit confidence
            signal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-ink-400">
          <span className="pill">{docList.total} documents indexed</span>
          <span className="pill">{recent.length} recent queries</span>
          <span className="pill-cyan">provider · {system.ai_provider}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <StatusCards
            components={system.components}
            version={system.version}
            provider={system.ai_provider}
          />
          <RecentQueries queries={recent} />
          <RecentDocuments documents={docList.documents} />
        </div>
        <div className="space-y-6">
          <UploadCard />
          <Card
            title="Knowledge workspace"
            subtitle="Where mechanics live during a shift"
          >
            <p className="text-[12px] leading-relaxed text-ink-300">
              The Query Workspace is the heart of Topgun AI. Open it to
              ask cited questions, browse the Source Drawer, and chase
              follow-ups without leaving the panel.
            </p>
            <a href="/query" className="btn-ghost mt-4 w-full">
              Open Query Workspace →
            </a>
          </Card>
          <Card title="Tip" subtitle="Press / anywhere to focus search">
            <p className="text-[12px] text-ink-300">
              The command bar is keyboard-first. Use / to focus, ⌘K to
              open the palette, and ↵ to fire a query.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
