"use client";

import { useCallback, useEffect, useState } from "react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";

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

function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { wallets } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;

  const activeWalletMeta = walletAddress
    ? wallets.find((w) => w.address === walletAddress)
    : wallets[0] ?? null;
  const walletType = activeWalletMeta
    ? activeWalletMeta.walletClientType === "privy"
      ? "Embedded"
      : activeWalletMeta.walletClientType ?? "External"
    : null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setSolBalance(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/api/sol-balance/${walletAddress}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSolBalance(data.sol ?? null);
      })
      .catch(() => {
        if (!cancelled) setSolBalance(null);
      });
    return () => { cancelled = true; };
  }, [walletAddress]);

  const loadProjects = useCallback(async () => {
    if (!user?.privyId) {
      setProjects([]);
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`
      );
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
  }, [user?.privyId]);

  // On first load: backfill any orphaned projects (owner_id=null, wallet matches)
  // then load the project list. Safe to call repeatedly — no-ops if nothing to fix.
  useEffect(() => {
    if (!user?.privyId) return;
    fetch(
      `${API_BASE}/api/projects/backfill-owner?owner_id=${encodeURIComponent(user.privyId)}`,
      { method: "POST" }
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.updated > 0) console.log(`[backfill] claimed ${data.updated} project(s)`);
      })
      .catch(() => {})
      .finally(() => loadProjects());
  }, [user?.privyId, loadProjects]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      alert("Please enter a project name");
      return;
    }

    if (!user?.privyId) {
      alert("Please sign in to create a project.");
      return;
    }

    try {
      setLoading(true);

      const tokenSymbol = deriveTokenSymbolFromName(name);

      const res = await fetch(`${API_BASE}/api/projects/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          user_id: user.privyId,
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

  async function deleteProject(project: Project) {
    if (!user?.privyId) return;
    const label = project.title || project.name || "this project";
    if (!confirm(`Remove "${label}" from your dashboard? This cannot be undone.`)) return;

    setDeletingId(project.id);
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${project.id}?owner_id=${encodeURIComponent(user.privyId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail || "Failed to delete project");
      }
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  }

  function copyAddress() {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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

          {/* Wallet identity row */}
          {user && (
            <div className="mt-5 inline-flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm">
              {walletAddress ? (
                <>
                  <span className="font-mono text-zinc-300" title={walletAddress}>
                    {shortAddress(walletAddress)}
                  </span>
                  {walletType && (
                    <span className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-500">
                      {walletType}
                    </span>
                  )}
                  {solBalance !== null && (
                    <span className="font-mono text-zinc-400">
                      {solBalance.toFixed(4)} SOL
                    </span>
                  )}
                  <span className="text-zinc-700">·</span>
                  <button
                    type="button"
                    onClick={copyAddress}
                    className="text-xs text-zinc-500 transition hover:text-zinc-300"
                  >
                    {copied ? "Copied!" : "Copy address"}
                  </button>
                  <a
                    href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-500 transition hover:text-zinc-300"
                  >
                    Explorer ↗
                  </a>
                  <a
                    href="https://faucet.solana.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-500 transition hover:text-emerald-400"
                    title="Get test SOL — devnet only"
                  >
                    Get test SOL ↗
                  </a>
                </>
              ) : (
                <span className="text-zinc-500">No wallet connected</span>
              )}
            </div>
          )}
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
                  <div key={project.id} className="group relative rounded-xl border border-zinc-800 bg-black transition hover:border-purple-500 hover:bg-zinc-900">
                    <Link href={`/project/${project.id}`} className="block p-5">
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
                    </Link>

                    <button
                      type="button"
                      onClick={() => deleteProject(project)}
                      disabled={deletingId === project.id}
                      className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-zinc-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                      title="Remove project"
                    >
                      {deletingId === project.id ? "…" : "✕"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
