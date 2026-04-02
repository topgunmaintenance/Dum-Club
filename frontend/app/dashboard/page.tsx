"use client";

import { useCallback, useEffect, useState } from "react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { Starfield } from "../../components/Starfield";

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
  const [dumBalance, setDumBalance] = useState(0);

  useEffect(() => {
    const val = Number(localStorage.getItem("dum_points") || "50");
    setDumBalance(val);
    const handler = () => setDumBalance(Number(localStorage.getItem("dum_points") || "0"));
    window.addEventListener("dum-points-update", handler);
    return () => window.removeEventListener("dum-points-update", handler);
  }, []);

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
    <div className="relative min-h-screen bg-base px-4 py-12 text-white sm:px-6">
      <Starfield count={50} />
      <div className="relative z-[1] mx-auto max-w-5xl">

        {/* Header */}
        <div className="mb-10">
          <div className="text-[10px] uppercase tracking-[0.35em] text-zinc-600">
            Command Center
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Dashboard
          </h1>
          <p className="mt-2 text-sm text-zinc-500">Manage your projects and wallet</p>
        </div>

        {/* Stats + Wallet + CTA row */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Total Projects */}
          <div className="rounded-2xl border border-zinc-800 bg-card p-6">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Total Projects
            </div>
            <div className="mt-2 font-mono text-3xl font-bold text-white">
              {projects.length}
            </div>
          </div>

          {/* Live Projects */}
          <div className="rounded-2xl border border-zinc-800 bg-card p-6">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Live
            </div>
            <div className="mt-2 font-mono text-3xl font-bold text-emerald-400">
              {liveCount}
            </div>
          </div>

          {/* Wallet + Balance */}
          <div className="rounded-2xl border border-zinc-800 bg-card p-6 lg:col-span-2">
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

        {/* DUM Points card */}
        <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/60">DUM Points</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-2xl font-extrabold text-emerald-400">{dumBalance}</span>
                <span className="text-sm text-zinc-500">points</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Use for discounts, boosts, and features across all businesses</p>
            </div>
            <Link
              href="/upgrade"
              className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-2 text-xs font-bold text-emerald-400 transition hover:border-emerald-400/50 hover:bg-emerald-400/10"
            >
              Get More →
            </Link>
          </div>
        </div>

        {/* Quick actions */}
        <div className="mb-10 grid gap-4 sm:grid-cols-2">
          <Link
            href="/build"
            className="group flex items-center justify-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-6 py-6 transition hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,255,163,0.08)]"
          >
            <span className="text-2xl">🚀</span>
            <span className="text-lg font-bold text-emerald-400">Generate Project</span>
          </Link>
          <Link
            href="/orders"
            className="group flex items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-card px-6 py-6 transition hover:border-zinc-700 hover:-translate-y-0.5"
          >
            <span className="text-2xl">📦</span>
            <span className="text-lg font-bold text-zinc-300">My Orders</span>
          </Link>
        </div>

        {/* ── Action Prompts ── */}
        {user && (
          <div className="mb-10">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-emerald-400/20 bg-emerald-400/[0.03] p-6 text-center">
                <div className="mb-2 text-2xl">💡</div>
                <div className="mb-1 text-base font-bold text-white">Launch your first project</div>
                <p className="mb-4 text-sm text-zinc-400">Describe your idea and AI will build your project page with offers in under 60 seconds.</p>
                <Link
                  href="/build"
                  className="inline-flex items-center rounded-xl bg-emerald-400 px-6 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-300"
                >
                  Start Building →
                </Link>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                {projects.some((p) => p.status === "live") && (
                  <button
                    type="button"
                    onClick={() => {
                      const live = projects.find((p) => p.status === "live");
                      if (live) {
                        const url = `${window.location.origin}/project/${live.id}`;
                        navigator.clipboard.writeText(url).catch(() => {});
                        alert("Link copied! Share it with your audience.");
                      }
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-card p-4 text-left transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.03]"
                  >
                    <span className="text-xl">🔗</span>
                    <div>
                      <div className="text-sm font-bold text-white">Share your page</div>
                      <div className="text-xs text-zinc-500">Copy your project link</div>
                    </div>
                  </button>
                )}
                {projects.some((p) => p.status === "live") && (
                  <Link
                    href={`/project/${projects.find((p) => p.status === "live")?.id}#offers-section`}
                    className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-card p-4 text-left transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.03]"
                  >
                    <span className="text-xl">🏷️</span>
                    <div>
                      <div className="text-sm font-bold text-white">Manage your offers</div>
                      <div className="text-xs text-zinc-500">Add or edit what you sell</div>
                    </div>
                  </Link>
                )}
                <Link
                  href="/orders"
                  className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-card p-4 text-left transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.03]"
                >
                  <span className="text-xl">📊</span>
                  <div>
                    <div className="text-sm font-bold text-white">View your orders</div>
                    <div className="text-xs text-zinc-500">Track sales and fulfillment</div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        )}

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
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map((project) => {
                const st = statusLabel(project);
                const ticker = project.token_symbol
                  ? `$${project.token_symbol.replace(/^\$/, "").toUpperCase()}`
                  : null;
                return (
                  <div
                    key={project.id}
                    className="group relative rounded-2xl border border-zinc-800 bg-card transition hover:border-zinc-700 hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
                  >
                    <Link href={`/project/${project.id}`} className="block p-6">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-semibold text-white group-hover:text-emerald-50">
                          {project.title || project.name || "Untitled Project"}
                        </h3>
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${st.color}`}>
                          {st.text}
                        </span>
                      </div>

                      {/* ticker hidden — DUM Points replaces per-project tokens */}

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-zinc-600">
                          {project.template_type || "General"}
                        </span>
                        <span className="text-xs text-zinc-600 opacity-0 transition group-hover:opacity-100">View →</span>
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
