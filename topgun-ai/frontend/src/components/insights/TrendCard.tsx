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
    <Card title={widget.label}>
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[36px] font-semibold leading-none text-ink-100">
            {widget.value}
          </div>
          {widget.unit && (
            <div className="label-eyebrow mt-2">{widget.unit}</div>
          )}
        </div>
        <div className={`text-2xl ${TREND_TONE[widget.trend]}`}>
          {TREND_GLYPH[widget.trend]}
        </div>
      </div>
      {widget.detail && (
        <p className="mt-4 border-t border-white/[0.06] pt-3 text-[11.5px] leading-relaxed text-ink-400">
          {widget.detail}
        </p>
      )}
    </Card>
  );
}
