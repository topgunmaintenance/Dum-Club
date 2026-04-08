import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
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
    <Card
      variant="accent"
      title="System status"
      subtitle={`v${version} · ${provider} provider`}
      action={<span className="pill-emerald">all critical paths up</span>}
    >
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
        {components.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-gunmetal-900/60 p-3 transition hover:border-cyan-500/20"
          >
            <div className="min-w-0">
              <div className="label-eyebrow">{c.id}</div>
              <div className="truncate text-[12.5px] font-medium text-ink-100">
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
