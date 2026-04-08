import { Card } from "@/components/ui/Card";
import type { FleetWidget } from "@/lib/types";

const TREND_GLYPH: Record<FleetWidget["trend"], string> = {
  rising: "▲",
  falling: "▼",
  flat: "—",
  stable: "—",
};
const TREND_TONE: Record<FleetWidget["trend"], string> = {
  rising: "text-amber-300",
  falling: "text-emerald-300",
  flat: "text-ink-400",
  stable: "text-ink-400",
};

export function TrendCard({ widget }: { widget: FleetWidget }) {
  return (
    <Card title={widget.label} subtitle={widget.detail ?? undefined}>
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-4xl text-ink-100">{widget.value}</div>
          {widget.unit && (
            <div className="mt-1 text-[11px] uppercase tracking-wider text-ink-400">
              {widget.unit}
            </div>
          )}
        </div>
        <div className={`text-2xl ${TREND_TONE[widget.trend]}`}>
          {TREND_GLYPH[widget.trend]}
        </div>
      </div>
    </Card>
  );
}
