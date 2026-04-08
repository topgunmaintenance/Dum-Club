import Link from "next/link";

import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { RecentQuery } from "@/lib/types";

export function RecentQueries({ queries }: { queries: RecentQuery[] }) {
  return (
    <Card
      title="Recent queries"
      subtitle="Latest questions across the team"
      action={
        <Link
          href="/query"
          className="text-[11px] uppercase tracking-[0.18em] text-cyan-300 hover:text-cyan-200"
        >
          New query →
        </Link>
      }
    >
      <ul className="divide-y divide-white/5">
        {queries.map((q) => (
          <li key={q.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="line-clamp-2 text-[13px] leading-snug text-ink-100">
                {q.question}
              </p>
              <Badge
                tone={
                  q.confidence === "high"
                    ? "emerald"
                    : q.confidence === "medium"
                      ? "cyan"
                      : q.confidence === "low"
                        ? "amber"
                        : "rose"
                }
              >
                {q.confidence}
              </Badge>
            </div>
            {q.created_at && (
              <div className="mt-1 text-[11px] text-ink-500">
                {formatRelative(q.created_at)}
              </div>
            )}
          </li>
        ))}
      </ul>
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
