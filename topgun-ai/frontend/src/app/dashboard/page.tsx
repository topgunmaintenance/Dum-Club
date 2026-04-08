import Link from "next/link";

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
      <header className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="pill-cyan mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            Operator workspace · live
          </div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em] text-ink-100 md:text-[38px]">
            Maintenance intelligence, organized.
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-300">
            Search manuals, records, and parts context instantly. Every
            answer is backed by source evidence and an explicit confidence
            signal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill">{docList.total} documents</span>
          <span className="pill">{recent.length} recent queries</span>
          <span className="pill-cyan">provider · {system.ai_provider}</span>
          {system.demo_mode && <span className="pill-amber">demo mode</span>}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <StatusCards
            components={system.components}
            version={system.version}
            provider={system.ai_provider}
          />
          <RecentQueries queries={recent} />
          <RecentDocuments documents={docList.documents} />
        </div>
        <div className="space-y-5">
          <UploadCard />
          <Card
            title="Knowledge workspace"
            subtitle="Where mechanics live during a shift"
          >
            <p className="text-[12.5px] leading-relaxed text-ink-300">
              The Query Workspace is the heart of Topgun AI. Open it to
              ask cited questions, browse the Source Drawer, and chase
              follow-ups without leaving the panel.
            </p>
            <Link href="/query" className="btn-ghost mt-4 w-full">
              Open Query Workspace →
            </Link>
          </Card>
          <Card title="Getting started" subtitle="Three steps to first query">
            <ol className="space-y-3 text-[12.5px]">
              <Step
                n="1"
                done={docList.total > 0}
                title="Ingest a document"
                body="Drop any PDF, TXT, or MD into the upload card."
              />
              <Step
                n="2"
                done={recent.length > 0}
                title="Ask a question"
                body="Open the Query Workspace and type freely."
              />
              <Step
                n="3"
                done={false}
                title="Verify a citation"
                body="Click any citation to open the source drawer."
              />
            </ol>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Step({
  n,
  done,
  title,
  body,
}: {
  n: string;
  done: boolean;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[10px] font-bold ${
          done
            ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300"
            : "border-white/10 bg-white/[0.03] text-ink-400"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-ink-100">{title}</div>
        <div className="text-[11px] text-ink-400">{body}</div>
      </div>
    </li>
  );
}
