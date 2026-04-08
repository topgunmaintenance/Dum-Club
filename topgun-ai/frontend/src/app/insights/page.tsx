import { AppShell } from "@/components/layout/AppShell";
import { IssueCluster } from "@/components/insights/IssueCluster";
import { TrendCard } from "@/components/insights/TrendCard";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SparkBar } from "@/components/ui/SparkBar";
import { safeInsights } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const insights = await safeInsights();
  const maxHotspot =
    insights.ata_hotspots.reduce((m, h) => Math.max(m, h.count_90d), 0) || 1;

  return (
    <AppShell subtitle="Maintenance Insights">
      <header className="mb-7">
        <div className="pill mb-3">Fleet intelligence</div>
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em] text-ink-100 md:text-[38px]">
          See the next bleed-air overtemp before it grounds an aircraft.
        </h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-300">
          Topgun AI clusters write-ups across the fleet, surfaces ATA hot
          spots, and feeds widgets you can act on this shift.
        </p>
      </header>

      {/* Fleet widgets */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {insights.fleet_widgets.map((w) => (
          <TrendCard key={w.id} widget={w} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Recurring clusters */}
        <div className="lg:col-span-2">
          <h2 className="label-eyebrow mb-3">Recurring fault clusters</h2>
          {insights.recurring_clusters.length === 0 ? (
            <Card>
              <EmptyState
                glyph="◇"
                title="No recurring clusters yet"
                body="Cluster analysis runs after enough write-ups are indexed."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {insights.recurring_clusters.map((c) => (
                <IssueCluster key={c.id} cluster={c} />
              ))}
            </div>
          )}
        </div>

        {/* ATA hotspots with sparkbars */}
        <div>
          <h2 className="label-eyebrow mb-3">ATA hot spots · 90 days</h2>
          <Card>
            {insights.ata_hotspots.length === 0 ? (
              <EmptyState
                glyph="△"
                title="No ATA data"
                body="Hot spots populate as documents are tagged with ATA chapters."
              />
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {insights.ata_hotspots.map((h) => (
                  <li key={h.ata} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between text-[13px]">
                      <div>
                        <div className="font-mono font-semibold text-ink-100">
                          {h.ata}
                        </div>
                        <div className="label-eyebrow">{h.label}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-ink-100">
                          {h.count_90d}
                        </div>
                        <div
                          className={`text-[11px] ${
                            h.delta_pct > 0
                              ? "text-amber-300"
                              : h.delta_pct < 0
                                ? "text-emerald-300"
                                : "text-ink-400"
                          }`}
                        >
                          {h.delta_pct > 0 ? "+" : ""}
                          {h.delta_pct}%
                        </div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <SparkBar
                        value={h.count_90d}
                        max={maxHotspot}
                        tone={h.delta_pct > 0 ? "amber" : "cyan"}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
