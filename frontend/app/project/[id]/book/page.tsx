"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { API_BASE } from "../../../../lib/apiBase";

export default function BookPage() {
  const { id } = useParams() as { id: string };

  const [project, setProject] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setProject((d?.project as Record<string, unknown>) || d);
      })
      .catch(() => {});
  }, [id]);

  const projectName =
    (project?.name as string) || (project?.title as string) || "this business";

  return (
    <div className="min-h-screen bg-surface-page text-primary">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 text-5xl" aria-hidden>
          💬
        </div>
        <h1 className="text-2xl font-bold">Interested? Send an inquiry.</h1>
        <p className="mt-4 text-base text-secondary">
          {projectName} isn&apos;t taking online bookings right now. Send a
          message and the business will follow up.
        </p>
        <Link
          href={`/project/${id}`}
          className="mt-8 inline-flex items-center justify-center rounded-xl bg-brand-teal px-6 py-3 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white"
        >
          Back to {projectName} →
        </Link>
        <p className="mt-6 text-xs text-muted">
          Use the chat at the bottom of the page to send a question.
        </p>
      </div>
    </div>
  );
}
