import { Card } from "@/components/ui/Card";
import { ConfidenceBadge } from "@/components/query/ConfidenceBadge";
import type { QueryResponse } from "@/lib/types";

export function AnswerPanel({ response }: { response: QueryResponse }) {
  return (
    <Card
      title="Executive answer"
      subtitle={`Latency ${response.latency_ms} ms · ${response.citations.length} citations`}
      action={
        <span className="pill">
          <span className="font-mono text-cyan-300">▰▰▰</span> mission panel
        </span>
      }
    >
      <p className="text-[14px] leading-relaxed text-ink-100">
        {response.answer}
      </p>

      <div className="mt-4">
        <ConfidenceBadge report={response.confidence} />
      </div>

      {response.sections.length > 0 && (
        <div className="mt-6 space-y-5">
          {response.sections.map((section) => (
            <section
              key={section.heading}
              className="rounded-xl border border-white/5 bg-gunmetal-900/50 p-4"
            >
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
                {section.heading}
              </div>
              <ul className="space-y-1.5 text-[13px] text-ink-200">
                {section.bullets.map((b, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                    <span>{b}</span>
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
