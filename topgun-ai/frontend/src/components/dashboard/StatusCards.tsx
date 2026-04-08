import { Card } from "@/components/ui/Card";
import { statusTone, Badge } from "@/components/ui/Badge";
import type { SystemComponent } from "@/lib/types";

export function StatusCards({
  components,
  version,
  provider,
}: {
  components: SystemComponent[];
  version: string;
  provider: string;
}) {
  return (
    <Card title="System status" subtitle={`v${version} · ${provider} provider`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {components.map((c) => (
          <div
            key={c.id}
            className="panel-tight flex items-center justify-between px-3 py-3"
          >
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink-400">
                {c.label}
              </div>
              <div className="font-mono text-[12px] text-ink-200">{c.id}</div>
            </div>
            <Badge tone={statusTone(c.status)}>{c.status}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}
