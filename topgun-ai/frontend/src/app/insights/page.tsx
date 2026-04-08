import { AppShell } from "@/components/layout/AppShell";
import { IssueCluster } from "@/components/insights/IssueCluster";
import { TrendCard } from "@/components/insights/TrendCard";
import { Card } from "@/components/ui/Card";
import { safeInsights } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const insights = await safeInsights();

  return (
    <AppShell subtitle="Maintenance Insights">
      <div className="mb-6">
        <div className="pill mb-3">Fleet intelligence</div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
          See the next bleed-air overtemp before it grounds another aircraft.
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-ink-300">
          Topgun AI clusters write-ups across the fleet, surfaces ATA hot
          spots, and feeds widgets you can act on this shift.
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {insights.fleet_widgets.map((w) => (
          <TrendCard key={w.id} widget={w} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-ink-400">
            Recurring fault clusters
          </h2>
          <div className="grid grid-cols-1 gap-4">
            {insights.recurring_clusters.map((c) => (
              <IssueCluster key={c.id} cluster={c} />
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-ink-400">
            ATA hot spots · 90 days
          </h2>
          <Card>
            <ul className="divide-y divide-white/5">
              {insights.ata_hotspots.map((h) => (
                <li
                  key={h.ata}
                  className="flex items-center justify-between py-3 text-[13px]"
                >
                  <div>
                    <div className="font-mono text-ink-100">{h.ata}</div>
                    <div className="text-[11px] text-ink-400">{h.label}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-ink-100">{h.count_90d}</div>
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
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
