import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export function FollowupPrompts({ prompts }: { prompts: string[] }) {
  return (
    <Card title="Suggested follow-ups" subtitle="Common next questions">
      {prompts.length === 0 ? (
        <EmptyState
          glyph="↳"
          title="No follow-ups"
          body="Follow-up prompts appear alongside cited answers."
        />
      ) : (
        <ul className="space-y-2">
          {prompts.map((p, idx) => (
            <li key={idx}>
              <button className="group flex w-full items-start gap-3 rounded-lg border border-white/[0.06] bg-gunmetal-900/60 p-3 text-left text-[12.5px] leading-snug text-ink-200 transition hover:border-cyan-500/40 hover:bg-gunmetal-900/80 hover:text-cyan-100">
                <span className="mt-0.5 font-mono text-cyan-400 group-hover:text-cyan-300">
                  ↳
                </span>
                {p}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
