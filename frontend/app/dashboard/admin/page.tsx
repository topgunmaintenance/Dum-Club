"use client";

import { useEffect, useState } from "react";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type PendingProject = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  category?: string;
  token_symbol?: string;
  created_at?: string;
};

const REJECTION_REASONS = [
  "Adult / sexual content",
  "Scam / misleading",
  "Low quality / spam",
  "Unsafe / harmful service",
  "Not aligned with ecosystem",
  "Duplicate / copycat",
];

function AdminReviewQueue() {
  const { getToken } = useAuth();
  const [projects, setProjects] = useState<PendingProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});

  const requireToken = async (): Promise<string | null> => {
    const token = await getToken();
    if (!token) {
      setError("Your session expired. Please sign in again.");
      return null;
    }
    return token;
  };

  const fetchPending = async () => {
    try {
      setError(null);
      const token = await requireToken();
      if (!token) {
        setLoading(false);
        return;
      }
      const res = await fetch(`${API_BASE}/api/admin/projects/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Failed to load queue (${res.status})`);
      }
      setProjects(await res.json());
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load review queue";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (projectId: string) => {
    try {
      setError(null);
      setBusyProjectId(projectId);
      const token = await requireToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/admin/projects/${projectId}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(`Approve failed (${res.status})`);
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to approve project";
      setError(message);
    } finally {
      setBusyProjectId(null);
    }
  };

  const handleReject = async (projectId: string) => {
    const reason = rejectionReason[projectId];
    if (!reason) return alert("Select a rejection reason first");
    try {
      setError(null);
      setBusyProjectId(projectId);
      const token = await requireToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/admin/projects/${projectId}/reject`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        throw new Error(`Reject failed (${res.status})`);
      }
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to reject project";
      setError(message);
    } finally {
      setBusyProjectId(null);
    }
  };

  if (loading) return <div className="p-8 text-zinc-400">Loading review queue...</div>;

  return (
    <div className="mx-auto max-w-5xl p-8 font-mono">
      <h1 className="mb-6 text-3xl font-black text-white">
        Admin review queue ({projects.length})
      </h1>
      {error && (
        <div className="mb-4 rounded-md border border-red-500/60 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {projects.length === 0 && <p className="text-zinc-500">No projects pending review.</p>}
      <div className="space-y-5">
        {projects.map((project) => (
          <div key={project.id} className="rounded-xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">{project.name || project.title}</h2>
              <span className="text-xs text-zinc-500">
                {project.created_at
                  ? new Date(project.created_at).toLocaleDateString()
                  : "unknown"}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
              <div>Token: ${project.token_symbol || "N/A"}</div>
              <div>Category: {project.category || "N/A"}</div>
            </div>
            <p className="mb-4 text-sm text-zinc-300">{project.description}</p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => handleApprove(project.id)}
                disabled={busyProjectId === project.id}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-bold text-black"
              >
                {busyProjectId === project.id ? "Working..." : "Approve"}
              </button>
              <select
                value={rejectionReason[project.id] || ""}
                onChange={(e) =>
                  setRejectionReason((prev) => ({ ...prev, [project.id]: e.target.value }))
                }
                className="rounded-md border border-red-500 bg-black px-3 py-2 text-sm text-white"
              >
                <option value="">Select rejection reason</option>
                {REJECTION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                onClick={() => handleReject(project.id)}
                disabled={busyProjectId === project.id}
                className="rounded-md bg-red-500 px-4 py-2 text-sm font-bold text-white"
              >
                {busyProjectId === project.id ? "Working..." : "Reject"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  return (
    <AdminRoute>
      <AdminReviewQueue />
    </AdminRoute>
  );
}
