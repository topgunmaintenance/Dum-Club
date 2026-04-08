import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { SystemComponent } from "@/lib/types";

export function SystemStatusGrid({
  components,
}: {
  components: SystemComponent[];
}) {
  return (
    <Card
      variant="accent"
      title="System health"
      subtitle="Live component status"
      action={<span className="pill-emerald">monitored</span>}
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {components.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-gunmetal-900/60 p-3.5 transition hover:border-cyan-500/25"
          >
            <div className="min-w-0">
              <div className="label-eyebrow">{c.id}</div>
              <div className="truncate text-[13px] font-medium text-ink-100">
                {c.label}
              </div>
            </div>
            <Badge tone={statusTone(c.status)} dot>
              {c.status}
            </Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
