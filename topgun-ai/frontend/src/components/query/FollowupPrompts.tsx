import { Card } from "@/components/ui/Card";

export function FollowupPrompts({ prompts }: { prompts: string[] }) {
  return (
    <Card title="Suggested follow-ups" subtitle="Common next questions">
      {prompts.length === 0 ? (
        <p className="text-[12px] text-ink-400">No follow-ups suggested.</p>
      ) : (
        <ul className="space-y-2">
          {prompts.map((p, idx) => (
            <li key={idx}>
              <button className="group flex w-full items-start gap-3 rounded-lg border border-white/5 bg-gunmetal-900/60 p-3 text-left text-[12px] text-ink-200 transition hover:border-cyan-500/40 hover:text-cyan-100">
                <span className="font-mono text-cyan-400 group-hover:text-cyan-300">
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
