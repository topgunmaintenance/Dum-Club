import { Card } from "@/components/ui/Card";
import type { ExtractedEntity } from "@/lib/types";

const KIND_LABEL: Record<ExtractedEntity["kind"], string> = {
  aircraft: "aircraft",
  tail_number: "tail",
  ata: "ata",
  part_number: "part",
  bulletin: "bulletin",
  inspector: "inspector",
  date: "date",
};

export function EntitiesPanel({ entities }: { entities: ExtractedEntity[] }) {
  return (
    <Card title="Extracted entities" subtitle="Named values pulled from sources">
      {entities.length === 0 ? (
        <p className="text-[12px] text-ink-400">No entities extracted.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {entities.map((e, idx) => (
            <li
              key={`${e.kind}-${e.value}-${idx}`}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-gunmetal-900/60 px-3 py-2 text-[12px]"
            >
              <span className="text-[10px] uppercase tracking-[0.18em] text-ink-400">
                {KIND_LABEL[e.kind]}
              </span>
              <span className="font-mono text-cyan-200">{e.value}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
