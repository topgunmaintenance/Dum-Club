import { AppShell } from "@/components/layout/AppShell";
import { AnswerPanel } from "@/components/query/AnswerPanel";
import { CitationsPanel } from "@/components/query/CitationsPanel";
import { EntitiesPanel } from "@/components/query/EntitiesPanel";
import { FollowupPrompts } from "@/components/query/FollowupPrompts";
import { QueryInput } from "@/components/query/QueryInput";
import { RelatedDocsPanel } from "@/components/query/RelatedDocsPanel";
import { api } from "@/lib/api";
import { demoData } from "@/lib/demoData";
import type { QueryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const DEFAULT_QUESTION =
  "What are the likely causes of hydraulic pressure fluctuation on the Citation XLS?";

async function loadAnswer(): Promise<QueryResponse> {
  try {
    return await api.ask(DEFAULT_QUESTION);
  } catch {
    return demoData.exampleQueryResponse;
  }
}

export default async function QueryWorkspacePage() {
  const response = await loadAnswer();

  return (
    <AppShell subtitle="Query Workspace">
      <div className="mb-6">
        <div className="pill-cyan mb-3">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
          Mission-critical intelligence panel
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
          Ask manuals, records, and parts data — together.
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-ink-300">
          Every answer is structured, cited, and scored. Topgun AI never
          invents part numbers, torque values, or procedural steps.
        </p>
      </div>

      <QueryInput initialQuestion={response.question} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <AnswerPanel response={response} />
          <CitationsPanel citations={response.citations} />
        </div>
        <div className="space-y-6">
          <EntitiesPanel entities={response.entities} />
          <RelatedDocsPanel docs={response.related_documents} />
          <FollowupPrompts prompts={response.followups} />
        </div>
      </div>
    </AppShell>
  );
}
