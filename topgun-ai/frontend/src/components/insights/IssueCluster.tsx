import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { RecurringCluster } from "@/lib/types";

const SEVERITY_TONE: Record<RecurringCluster["severity"], BadgeTone> = {
  low: "emerald",
  medium: "amber",
  high: "rose",
};

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
    <article className="panel p-5 transition hover:border-cyan-500/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={SEVERITY_TONE[cluster.severity]} dot>
              {cluster.severity}
            </Badge>
            <Badge tone="cyan">{cluster.ata}</Badge>
            <span className="pill">{cluster.aircraft}</span>
          </div>
          <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-ink-100">
            {cluster.title}
          </h3>
          {cluster.notes && (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
              {cluster.notes}
            </p>
          )}
        </div>
        <div
          className={`text-2xl ${TREND_TONE[cluster.trend]}`}
          aria-label={`trend ${cluster.trend}`}
        >
          {TREND_GLYPH[cluster.trend]}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-white/[0.06] pt-4">
        <div>
          <dt className="label-eyebrow">Write-ups · 90d</dt>
          <dd className="mt-1 font-mono text-[24px] font-semibold text-ink-100">
            {cluster.count_90d}
          </dd>
        </div>
        <div>
          <dt className="label-eyebrow">Aircraft</dt>
          <dd className="mt-1 font-mono text-[24px] font-semibold text-ink-100">
            {cluster.aircraft_count}
          </dd>
        </div>
        <div>
          <dt className="label-eyebrow">Last seen</dt>
          <dd className="mt-1 font-mono text-[14px] text-ink-200">
            {cluster.last_occurred}
          </dd>
        </div>
      </dl>
    </article>
  );
}
