import { Badge } from "@/components/ui/Badge";
import type { RecurringCluster } from "@/lib/types";

const SEVERITY_TONE = {
  low: "emerald",
  medium: "amber",
  high: "rose",
} as const;

const TREND_TONE = {
  rising: "text-amber-300",
  falling: "text-emerald-300",
  flat: "text-ink-400",
  stable: "text-ink-400",
} as const;

const TREND_GLYPH = {
  rising: "▲",
  falling: "▼",
  flat: "—",
  stable: "—",
} as const;

export function IssueCluster({ cluster }: { cluster: RecurringCluster }) {
  return (
    <article className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[cluster.severity]}>
              {cluster.severity}
            </Badge>
            <span className="pill">{cluster.ata}</span>
            <span className="pill">{cluster.aircraft}</span>
          </div>
          <h3 className="mt-3 text-base font-semibold text-ink-100">
            {cluster.title}
          </h3>
          {cluster.notes && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-300">
              {cluster.notes}
            </p>
          )}
        </div>
        <div className={`text-2xl ${TREND_TONE[cluster.trend]}`}>
          {TREND_GLYPH[cluster.trend]}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-white/5 pt-4 text-[11px] uppercase tracking-wider text-ink-400">
        <div>
          <dt>Write-ups · 90d</dt>
          <dd className="font-mono text-2xl text-ink-100">
            {cluster.count_90d}
          </dd>
        </div>
        <div>
          <dt>Aircraft</dt>
          <dd className="font-mono text-2xl text-ink-100">
            {cluster.aircraft_count}
          </dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd className="font-mono text-base text-ink-200">
            {cluster.last_occurred}
          </dd>
        </div>
      </dl>
    </article>
  );
}
