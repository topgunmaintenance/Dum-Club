"use client";

import { useCallback, useEffect, useState } from "react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { createClient } from "../../lib/supabase/client";

type Project = {
  id: number | string;
  name?: string;
  title?: string;
  description?: string;
  template_type?: string;
  status?: string;
  review_status?: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deriveTokenSymbolFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words
    .map((w) => w.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2))
    .join("")
    .slice(0, 5);
  const base =
    letters.length >= 3 ? letters : (letters + "DUM").slice(0, 5);
  return base.slice(0, 10);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { wallets } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { user: supabaseUser },
      } = await supabase.auth.getUser();

      if (!supabaseUser?.id) {
        setProjects([]);
        return;
      }

      let url = `${API_BASE}/api/projects/?owner_id=${supabaseUser.id}`;

      const res = await fetch(url);

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Failed to load projects");
      }

      const data = await res.json();
      setProjects(data.projects || data || []);
    } catch (err) {
      console.error(err);
      setProjects([]);
    }
  }, []);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      alert("Please enter a project name");
      return;
    }

    try {
      setLoading(true);

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id || !UUID_RE.test(user.id)) {
        alert("Please sign in to create a project.");
        return;
      }

      const userId = user.id;
      const tokenSymbol = deriveTokenSymbolFromName(name);

      const res = await fetch(`${API_BASE}/api/projects/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          user_id: userId,
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          name: name.trim(),
          title: name.trim(),
          description: `Project workspace for ${name.trim()}.`,
          category: "ai",
          utility_type: "access",
          utility_value: "Access to the project utility",
          token_supply: 21000000,
          token_symbol: tokenSymbol,
        }),
      });

      const data = await res.json().catch(() => ({}));
      console.log("create project response:", data);

      if (!res.ok) {
        throw new Error(data?.detail || data?.message || "Failed to create project");
      }

      setName("");
      await loadProjects();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className="min-h-screen bg-black px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10">
          <div className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-200">
            Your Projects
          </div>

          <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
            Dashboard
          </h1>

          <p className="mt-3 max-w-2xl text-zinc-400">
            Create and manage Solana-native AI projects from one place.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-bold md:text-2xl">Create Project</h2>

            <form onSubmit={createProject} className="mt-4 space-y-4">
              <div>
                <label className="mb-2 block text-sm text-zinc-400">
                  Project Name
                </label>

                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="AI Legacy Vault"
                  required
                  className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none focus:border-purple-500"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !user}
                className="w-full rounded-xl bg-purple-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Project"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
            <h2 className="text-xl font-bold md:text-2xl">Your Projects</h2>

            {!user ? (
              <p className="mt-4 text-zinc-400">
                Sign in to view and create projects.
              </p>
            ) : projects.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-zinc-700 bg-black/40 p-8 text-center">
                <p className="text-lg font-semibold text-zinc-200">
                  No projects yet
                </p>
                <p className="mt-2 text-sm text-zinc-500">
                  Spin up a workspace from the builder, or create a blank project here and open it
                  to add AI memory and launch.
                </p>
                <Link
                  href="/build"
                  className="mt-6 inline-flex rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition hover:border-emerald-400 hover:bg-emerald-500/20"
                >
                  Open builder →
                </Link>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {projects.map((project) => (
                  <Link key={project.id} href={`/project/${project.id}`}>
                    <div className="cursor-pointer rounded-xl border border-zinc-800 bg-black p-5 transition hover:border-purple-500 hover:bg-zinc-900">
                      <h3 className="text-lg font-semibold text-white">
                        {project.title || project.name || "Untitled Project"}
                      </h3>

                      <p className="mt-2 text-sm text-zinc-400">
                        {project.description || "No description yet."}
                      </p>

                      <div className="mt-4 flex gap-4 text-xs text-zinc-500">
                        <span>
                          Template: {project.template_type || "unknown"}
                        </span>
                        <span>
                          Review: {project.review_status || "—"} · Publication:{" "}
                          {project.status || "draft"}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
