import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ConfidenceLabel, RecentQuery } from "@/lib/types";

const CONF_TONE: Record<ConfidenceLabel, BadgeTone> = {
  high: "emerald",
  medium: "cyan",
  low: "amber",
  insufficient: "rose",
};

export function RecentQueries({ queries }: { queries: RecentQuery[] }) {
  return (
    <Card
      title="Recent queries"
      subtitle="Latest questions across the team"
      action={
        <Link
          href="/query"
          className="label-eyebrow text-cyan-300 hover:text-cyan-200"
        >
          New query →
        </Link>
      }
    >
      {queries.length === 0 ? (
        <EmptyState
          glyph="◇"
          title="No queries yet"
          body="Ask your first question in the Query Workspace."
        />
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {queries.map((q) => (
            <li key={q.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2 text-[13px] leading-snug text-ink-100">
                  {q.question}
                </p>
                <Badge tone={CONF_TONE[q.confidence]} dot>
                  {q.confidence}
                </Badge>
              </div>
              {q.created_at && (
                <div className="mono-meta mt-1">{formatRelative(q.created_at)}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
