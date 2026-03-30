"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ReviewProject = {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  token_symbol?: string | null;
  token_supply?: number | null;
  token_utility?: string | null;
  review_status?: string | null;
  status?: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function ReviewDashboardPage() {
  const [projects, setProjects] = useState<ReviewProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/projects/review-queue`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data?.detail || "Failed to load review queue");
      setProjects(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleApprove(projectId: string) {
    try {
      setWorkingId(projectId);
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          starting_price: 0.01,
          market_cap: 1000,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Failed to approve project");
      await loadQueue();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to approve project");
    } finally {
      setWorkingId(null);
    }
  }

  async function handleReject(projectId: string) {
    try {
      setWorkingId(projectId);
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Rejected from review dashboard",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Failed to reject project");
      await loadQueue();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to reject project");
    } finally {
      setWorkingId(null);
    }
  }

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  return (
    <div className="min-h-screen bg-base px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-zinc-600">Admin</div>
            <h1 className="mt-2 font-mono text-4xl font-bold text-white">Review Queue</h1>
          </div>
          <Link
            href="/dashboard"
            className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs uppercase tracking-[0.2em] text-zinc-300 transition hover:bg-zinc-800"
          >
            Back to Dashboard
          </Link>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-400">
            Loading review queue...
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-400">
            No projects currently awaiting review.
          </div>
        ) : (
          <div className="space-y-4">
            {projects.map((project) => (
              <div key={project.id} className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <h2 className="font-mono text-2xl text-white">
                      {project.title || project.name || "Untitled Project"}
                    </h2>
                    <p className="mt-2 text-zinc-400">
                      {project.description || "No description provided."}
                    </p>
                  </div>
                  <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs uppercase tracking-[0.18em] text-zinc-300">
                    Review · {project.review_status || "unknown"}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-zinc-800 bg-base p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Token Symbol</div>
                    <div className="mt-1 text-white">{project.token_symbol || "-"}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-base p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Supply</div>
                    <div className="mt-1 text-white">{project.token_supply || "-"}</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-base p-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Utility</div>
                    <div className="mt-1 text-white">{project.token_utility || "-"}</div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={workingId === project.id}
                    onClick={() => handleApprove(project.id)}
                    className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
                  >
                    {workingId === project.id ? "Working..." : "APPROVE"}
                  </button>
                  <button
                    type="button"
                    disabled={workingId === project.id}
                    onClick={() => handleReject(project.id)}
                    className="rounded-xl border border-red-400/40 bg-red-950/20 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-900/20 disabled:opacity-50"
                  >
                    {workingId === project.id ? "Working..." : "REJECT"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
