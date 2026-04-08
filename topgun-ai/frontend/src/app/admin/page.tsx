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
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="pill mb-3">System</div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em] text-ink-100 md:text-[38px]">
            Operational health, at a glance.
          </h1>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-300">
            Ingestion queue, OCR worker, embedding worker, vector index,
            API, and AI provider — all in one panel.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="pill">v{system.version}</span>
          <span className="pill-cyan">provider · {system.ai_provider}</span>
          {system.demo_mode && <span className="pill-amber">demo mode</span>}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <SystemStatusGrid components={system.components} />
          <ProcessingLogs logs={system.logs} />
        </div>
        <div className="space-y-5">
          <Card title="Configuration" subtitle="Effective runtime settings">
            <ul className="space-y-2 text-[12px]">
              <Row k="version" v={system.version} />
              <Row k="env" v={system.demo_mode ? "demo" : "live"} />
              <Row k="ai_provider" v={system.ai_provider} />
              <Row k="vector_backend" v="memory" />
              <Row k="embedding_model" v="text-embedding-3-small" />
            </ul>
          </Card>
          <Card title="Worker controls" subtitle="Operator actions">
            <div className="space-y-2">
              <button className="btn-ghost w-full">Pause ingestion queue</button>
              <button className="btn-ghost w-full">Reindex selected document</button>
              <button className="btn-ghost w-full">Drain OCR worker</button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-400">
              Controls become functional once the production worker pool
              is wired in Phase 3.
            </p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-gunmetal-900/60 px-3 py-2">
      <span className="label-eyebrow">{k}</span>
      <span className="font-mono text-[12px] text-cyan-200">{v}</span>
    </li>
  );
}
