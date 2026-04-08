import { Badge, statusTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { SystemComponent } from "@/lib/types";

export function SystemStatusGrid({
  components,
}: {
  components: SystemComponent[];
}) {
  return (
    <Card title="System health" subtitle="Live component status">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {components.map((c) => (
          <div
            key={c.id}
            className="panel-tight flex items-center justify-between p-4"
          >
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-400">
                {c.id}
              </div>
              <div className="text-[14px] font-medium text-ink-100">
                {c.label}
              </div>
            </div>
            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
