import { AppShell } from "@/components/layout/AppShell";
import { ProcessingLogs } from "@/components/admin/ProcessingLogs";
import { SystemStatusGrid } from "@/components/admin/SystemStatus";
import { Card } from "@/components/ui/Card";
import { safeSystemStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const system = await safeSystemStatus();

  return (
    <AppShell subtitle="Admin / System">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="pill mb-3">System</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
            Operational health, at a glance.
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] text-ink-300">
            Ingestion queue, OCR worker, embedding worker, vector index,
            API, and AI provider — all in one panel.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-400">
          <span className="pill">v{system.version}</span>
          <span className="pill-cyan">provider · {system.ai_provider}</span>
          {system.demo_mode && <span className="pill-amber">demo mode</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SystemStatusGrid components={system.components} />
          <ProcessingLogs logs={system.logs} />
        </div>
        <div className="space-y-6">
          <Card title="Configuration" subtitle="Effective runtime settings">
            <ul className="space-y-3 text-[12px]">
              <Row k="version" v={system.version} />
              <Row k="env" v={system.demo_mode ? "demo" : "live"} />
              <Row k="ai_provider" v={system.ai_provider} />
              <Row k="vector_backend" v="memory" />
              <Row k="embedding_model" v="text-embedding-3-small" />
            </ul>
          </Card>
          <Card title="Worker controls" subtitle="Future operator actions">
            <div className="space-y-2">
              <button className="btn-ghost w-full">Pause ingestion queue</button>
              <button className="btn-ghost w-full">
                Reindex selected document
              </button>
              <button className="btn-ghost w-full">Drain OCR worker</button>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-white/5 bg-gunmetal-900/60 px-3 py-2">
      <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
        {k}
      </span>
      <span className="font-mono text-cyan-200">{v}</span>
    </li>
  );
}
