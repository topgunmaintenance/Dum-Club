import { Card } from "@/components/ui/Card";
import { ConfidenceBadge } from "@/components/query/ConfidenceBadge";
import type { QueryResponse } from "@/lib/types";

export function AnswerPanel({ response }: { response: QueryResponse }) {
  return (
    <Card
      variant="accent"
      title="Executive answer"
      subtitle={`Synthesized from ${response.citations.length} cited chunks`}
      action={<span className="pill-cyan">mission panel</span>}
    >
      <p className="text-[14.5px] leading-[1.65] text-ink-100">
        {response.answer}
      </p>

      <div className="mt-5">
        <ConfidenceBadge report={response.confidence} />
      </div>

      {response.sections.length > 0 && (
        <div className="mt-6 space-y-4">
          {response.sections.map((section) => (
            <section
              key={section.heading}
              className="rounded-xl border border-white/[0.06] bg-gunmetal-900/50 p-4"
            >
              <div className="label-eyebrow mb-2 text-cyan-300">
                {section.heading}
              </div>
              <ul className="space-y-2 text-[13px] text-ink-200">
                {section.bullets.map((b, idx) => (
                  <li key={idx} className="flex items-start gap-2.5">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                    <span className="leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
