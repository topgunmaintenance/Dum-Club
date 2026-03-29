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
  token_symbol?: string | null;
  token_status?: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function statusLabel(project: Project): { text: string; color: string } {
  const s = project.status || "draft";
  const ts = project.token_status;
  if (s === "live" && ts === "trading_live") return { text: "Live", color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" };
  if (s === "live") return { text: "Live", color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" };
  if (project.review_status === "submitted") return { text: "In Review", color: "text-amber-400 border-amber-400/30 bg-amber-400/10" };
  if (project.review_status === "approved") return { text: "Approved", color: "text-sky-400 border-sky-400/30 bg-sky-400/10" };
  return { text: "Draft", color: "text-zinc-500 border-zinc-700 bg-zinc-900" };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { wallets } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
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

  const liveCount = projects.filter((p) => p.status === "live").length;

  return (
    <div className="min-h-screen bg-black px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">

        {/* Header */}
        <div className="mb-8">
          <div className="text-xs uppercase tracking-[0.35em] text-zinc-600">
            Command Center
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Dashboard
          </h1>
        </div>

        {/* Stats + Wallet + CTA row */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* grid: 2 stat cards + 1 wide wallet card (spans 2 on lg) */}
          {/* Total Projects */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Total Projects
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-white">
              {projects.length}
            </div>
          </div>

          {/* Live Projects */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Live
            </div>
            <div className="mt-1 font-mono text-2xl font-bold text-emerald-400">
              {liveCount}
            </div>
          </div>

          {/* Wallet + Balance */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 lg:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Wallet
            </div>
            {walletAddress ? (
              <div className="mt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-zinc-300" title={walletAddress}>
                    {shortAddress(walletAddress)}
                  </span>
                  <span className="font-mono text-lg font-bold text-white">
                    {solBalance !== null ? `${solBalance.toFixed(4)}` : "—"}
                    <span className="ml-1 text-xs font-normal text-zinc-500">SOL</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={copyAddress}
                    className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
                  >
                    {copied ? "Copied ✓" : "Copy address"}
                  </button>
                  <a
                    href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500 transition hover:border-zinc-600 hover:text-zinc-300"
                  >
                    Explorer ↗
                  </a>
                  <a
                    href="https://faucet.solana.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[11px] text-emerald-400/80 transition hover:border-emerald-400/40 hover:text-emerald-400"
                  >
                    Get test SOL ↗
                  </a>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-zinc-600">No wallet connected</div>
            )}
          </div>
        </div>

        {/* Generate Project CTA */}
        <Link
          href="/build"
          className="mb-8 flex items-center justify-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-6 py-5 transition hover:border-emerald-400/40 hover:bg-emerald-400/10"
        >
          <span className="text-2xl">🚀</span>
          <span className="text-lg font-bold text-emerald-400">Generate Project</span>
          <span className="text-sm text-zinc-500">Describe an idea and launch instantly</span>
        </Link>

        {/* Projects list */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-[0.3em] text-zinc-600">
              Your Projects
            </h2>
            <span className="text-xs text-zinc-700">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </span>
          </div>

          {!user ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
              <p className="text-sm text-zinc-500">Sign in to view your projects.</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-10 text-center">
              <p className="text-base font-semibold text-zinc-300">No projects yet</p>
              <p className="mt-2 text-sm text-zinc-600">
                Generate your first project to get started.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {projects.map((project) => {
                const st = statusLabel(project);
                const ticker = project.token_symbol
                  ? `$${project.token_symbol.replace(/^\$/, "").toUpperCase()}`
                  : null;
                return (
                  <div
                    key={project.id}
                    className="group relative rounded-2xl border border-zinc-800 bg-zinc-950 transition hover:border-emerald-400/20"
                  >
                    <Link href={`/project/${project.id}`} className="block p-5">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold text-white">
                          {project.title || project.name || "Untitled Project"}
                        </h3>
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${st.color}`}>
                          {st.text}
                        </span>
                      </div>

                      {ticker && (
                        <div className="mt-2 font-mono text-sm text-zinc-500">{ticker}</div>
                      )}

                      <div className="mt-3 text-xs text-zinc-600">
                        {project.template_type || "General"}
                      </div>
                    </Link>

                    <button
                      type="button"
                      onClick={() => deleteProject(project)}
                      disabled={deletingId === project.id}
                      className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs text-zinc-700 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
                      title="Remove project"
                    >
                      {deletingId === project.id ? "…" : "✕"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
