import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
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
        <EmptyState
          glyph="◎"
          title="No entities"
          body="Entity extraction runs after ingestion. Index documents to populate this panel."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-1.5">
          {entities.map((e, idx) => (
            <li
              key={`${e.kind}-${e.value}-${idx}`}
              className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-gunmetal-900/60 px-3 py-2 transition hover:border-cyan-500/25"
            >
              <span className="label-eyebrow">{KIND_LABEL[e.kind]}</span>
              <span className="font-mono text-[12px] text-cyan-200">
                {e.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
