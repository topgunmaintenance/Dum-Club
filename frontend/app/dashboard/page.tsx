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
  const { user, getToken } = useAuth();
  const { wallets } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);
  const [dumBalance, setDumBalance] = useState(0);
  const [bizProfile, setBizProfile] = useState<any>(null);
  const [bizLoading, setBizLoading] = useState(false);
  const [showBizForm, setShowBizForm] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizCategory, setBizCategory] = useState("General");
  const [bizDesc, setBizDesc] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  const [bizSaving, setBizSaving] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    async function loadDum() {
      const privyId = user?.privyId;
      if (privyId) {
        try {
          const res = await fetch(`${API_BASE}/api/dum/balance/${encodeURIComponent(privyId)}`);
          if (res.ok) {
            const data = await res.json();
            setDumBalance(data.balance ?? 50);
            localStorage.setItem("dum_points", String(data.balance ?? 50));
            return;
          }
        } catch {}
      }
      setDumBalance(Number(localStorage.getItem("dum_points") || "50"));
    }
    loadDum();
    const handler = () => setDumBalance(Number(localStorage.getItem("dum_points") || "0"));
    window.addEventListener("dum-points-update", handler);
    return () => window.removeEventListener("dum-points-update", handler);
  }, [user]);

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

  // Load business profile
  useEffect(() => {
    if (!user?.privyId) return;
    async function loadBiz() {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/business/me`, { headers });
        if (res.ok) {
          const data = await res.json();
          setBizProfile(data.profile || null);
        }
      } catch {}
    }
    loadBiz();
  }, [user?.privyId]);

  // Load business analytics
  useEffect(() => {
    if (!bizProfile) return;
    setAnalyticsLoading(true);
    (async () => {
      try {
        const token = await (user as any)?.getToken?.();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/business/analytics`, { headers });
        if (res.ok) {
          const data = await res.json();
          setAnalytics(data);
        }
      } catch {} finally {
        setAnalyticsLoading(false);
      }
    })();
  }, [bizProfile]);

  async function createBusiness() {
    if (!bizName.trim() || bizSaving) return;
    setBizSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          business_name: bizName.trim(),
          category: bizCategory,
          short_description: bizDesc.trim() || null,
          contact_email: bizEmail.trim() || null,
          website: bizWebsite.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBizProfile(data.profile);
        setShowBizForm(false);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to create business profile");
      }
    } catch (err) {
      alert("Failed to create business profile");
    } finally {
      setBizSaving(false);
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
          <p className="mt-2 text-sm text-zinc-500">Manage your businesses</p>
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

          {/* Account + Balance */}
          <div className="rounded-2xl border border-zinc-800 bg-card p-6 lg:col-span-2">
            <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Account
            </div>
            {walletAddress ? (
              <div className="mt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-sm font-medium text-emerald-400">Active</span>
                  </span>
                  <span className="font-mono text-lg font-bold text-white">
                    {solBalance !== null ? `${solBalance.toFixed(4)}` : "—"}
                    <span className="ml-1 text-xs font-normal text-zinc-500">balance</span>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-600">
                  Payments and ownership secured
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm text-zinc-600">No wallet connected</div>
            )}
          </div>
        </div>

        {/* DUM Points + Tier Progress */}
        <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-400/[0.04] to-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/60">DUM Points</span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                  dumBalance >= 500 ? "bg-amber-400/10 text-amber-400 border border-amber-400/20" :
                  dumBalance >= 150 ? "bg-violet-400/10 text-violet-400 border border-violet-400/20" :
                  dumBalance >= 50 ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20" :
                  "bg-zinc-800 text-zinc-500 border border-zinc-700"
                }`}>
                  {dumBalance >= 500 ? "Mogul" : dumBalance >= 150 ? "Operator" : dumBalance >= 50 ? "Builder" : "Starter"}
                </span>
              </div>
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
          {/* Tier progress */}
          <div className="mt-4 border-t border-zinc-800/30 pt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-zinc-500">Progress to next tier</span>
              <span className="text-[10px] font-bold text-zinc-400">
                {dumBalance >= 500 ? "Max tier reached" :
                 dumBalance >= 150 ? `${500 - dumBalance} to Mogul` :
                 dumBalance >= 50 ? `${150 - dumBalance} to Operator` :
                 `${50 - dumBalance} to Builder`}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                style={{
                  width: `${dumBalance >= 500 ? 100 :
                    dumBalance >= 150 ? ((dumBalance - 150) / 350) * 100 :
                    dumBalance >= 50 ? ((dumBalance - 50) / 100) * 100 :
                    (dumBalance / 50) * 100}%`
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[8px] text-zinc-700">
              <span>Starter</span><span>Builder</span><span>Operator</span><span>Mogul</span>
            </div>
          </div>
        </div>

        {/* DUM Received from customers */}
        {projects.length > 0 && !analytics && (() => {
          const received = projects.reduce((sum, p) => sum + Number(localStorage.getItem(`dum_received_${p.id}`) || "0"), 0);
          return (
            <div className="mb-6 rounded-2xl border border-violet-500/15 bg-gradient-to-r from-violet-500/[0.03] to-zinc-950 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-violet-400/60">DUM from Customers</div>
                  {received > 0 ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xl font-extrabold text-violet-400">{received}</span>
                      <span className="text-sm text-zinc-500">earned from purchases</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-zinc-500">Earn DUM when customers purchase your offers</p>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Business Profile */}
        {user && (
          <div className="mb-6">
            {bizProfile ? (
              <div className="rounded-2xl border border-zinc-800 bg-gradient-to-r from-zinc-950 to-zinc-900/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-lg">
                      🏢
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white">{bizProfile.business_name}</span>
                        {bizProfile.verification_status === "verified" && (
                          <span className="rounded-full bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-400">✓ Verified</span>
                        )}
                        {bizProfile.verification_status === "pending" && (
                          <span className="rounded-full bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-amber-400">Pending</span>
                        )}
                        {bizProfile.verification_status === "unverified" && (
                          <span className="rounded-full bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-zinc-500">Unverified</span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-500">{bizProfile.category} · Accepts DUM Points</div>
                    </div>
                  </div>
                  {bizProfile.verification_status === "unverified" && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const token = await getToken();
                          const res = await fetch(`${API_BASE}/api/business/request-verification`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              ...(token ? { Authorization: `Bearer ${token}` } : {}),
                            },
                            body: JSON.stringify({ website: bizProfile.website, contact_email: bizProfile.contact_email }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setBizProfile(data.profile);
                          }
                        } catch {}
                      }}
                      className="shrink-0 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-2 text-xs font-bold text-emerald-400 transition hover:border-emerald-400/50 hover:bg-emerald-400/10"
                    >
                      Request Verification
                    </button>
                  )}
                </div>
                {bizProfile.short_description && (
                  <p className="mt-3 text-xs text-zinc-400">{bizProfile.short_description}</p>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-5">
                {showBizForm ? (
                  <div className="space-y-3">
                    <div className="text-sm font-bold text-white">Create your business profile</div>
                    <input
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      placeholder="Business name"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <select
                        value={bizCategory}
                        onChange={(e) => setBizCategory(e.target.value)}
                        className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-white outline-none"
                      >
                        {["General", "Food & Beverage", "Health & Fitness", "Technology", "Creative", "Services", "Retail", "Gaming", "Education"].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        value={bizEmail}
                        onChange={(e) => setBizEmail(e.target.value)}
                        placeholder="Contact email (optional)"
                        className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                      />
                    </div>
                    <textarea
                      value={bizDesc}
                      onChange={(e) => setBizDesc(e.target.value)}
                      placeholder="Short description of your business"
                      rows={2}
                      className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-400/40"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={createBusiness}
                        disabled={!bizName.trim() || bizSaving}
                        className="rounded-xl bg-emerald-400 px-5 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-300 disabled:opacity-50"
                      >
                        {bizSaving ? "Creating..." : "Create Business"}
                      </button>
                      <button
                        onClick={() => setShowBizForm(false)}
                        className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm text-zinc-400 transition hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">Set up your business profile</div>
                      <p className="mt-1 text-xs text-zinc-500">Add your business identity, get verified, and accept DUM Points</p>
                    </div>
                    <button
                      onClick={() => setShowBizForm(true)}
                      className="shrink-0 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-bold text-black transition hover:bg-emerald-300"
                    >
                      Create Business Profile
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Business Analytics */}
        {bizProfile && analytics && (
          <div className="mb-6">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Business Performance</div>

            {/* Headline metrics */}
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Page Views</div>
                <div className="mt-1 font-mono text-2xl font-bold text-white">{(analytics.total_views || 0).toLocaleString()}</div>
                <div className="mt-1 text-[11px] text-zinc-600">across all projects</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Sales</div>
                <div className="mt-1 font-mono text-2xl font-bold text-emerald-400">{analytics.total_orders || 0}</div>
                <div className="mt-1 text-[11px] text-zinc-600">completed purchases</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-card p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">Revenue</div>
                <div className="mt-1 font-mono text-2xl font-bold text-white">
                  ${(analytics.total_revenue_usd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-1 text-[11px] text-zinc-600">total earned</div>
              </div>
              <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.03] to-zinc-950 p-5">
                <div className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/60">DUM Received</div>
                <div className="mt-1 font-mono text-2xl font-bold text-emerald-400">{analytics.total_dum_received || 0}</div>
                <div className="mt-1 text-[11px] text-zinc-600">
                  {analytics.dum_discount_orders > 0
                    ? `${analytics.dum_discount_orders} order${analytics.dum_discount_orders !== 1 ? "s" : ""} used DUM discount`
                    : "from customer DUM spending"}
                </div>
              </div>
            </div>

            {/* Per-project breakdown */}
            {analytics.projects && analytics.projects.length > 0 && (
              <div className="mb-4 rounded-2xl border border-zinc-800 bg-card p-5">
                <div className="mb-3 text-xs font-bold text-white">Project Performance</div>
                <div className="space-y-2">
                  {analytics.projects.map((p: any) => (
                    <Link
                      key={p.id}
                      href={`/project/${p.id}`}
                      className="flex items-center justify-between rounded-xl border border-zinc-800/50 bg-zinc-950/50 px-4 py-3 transition hover:border-zinc-700"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${p.status === "live" ? "bg-emerald-400" : "bg-zinc-600"}`} />
                        <span className="truncate text-sm font-medium text-white">{p.title}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-4 text-[11px] text-zinc-500">
                        <span title="Views">{(p.views || 0).toLocaleString()} views</span>
                        <span title="Sales">{p.orders || 0} sales</span>
                        <span title="Revenue" className="font-medium text-zinc-300">${(p.revenue_usd || 0).toFixed(2)}</span>
                        {(p.dum_received || 0) > 0 && (
                          <span title="DUM received" className="text-emerald-400/70">+{p.dum_received} DUM</span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Top offers */}
            {analytics.top_offers && analytics.top_offers.length > 0 && analytics.top_offers.some((o: any) => (o.quantity_sold || 0) > 0) && (
              <div className="mb-4 rounded-2xl border border-zinc-800 bg-card p-5">
                <div className="mb-3 text-xs font-bold text-white">Top Offers</div>
                <div className="space-y-2">
                  {analytics.top_offers.filter((o: any) => (o.quantity_sold || 0) > 0).map((offer: any) => (
                    <div key={offer.id} className="flex items-center justify-between rounded-xl border border-zinc-800/50 bg-zinc-950/50 px-4 py-3">
                      <span className="truncate text-sm text-zinc-300">{offer.title}</span>
                      <div className="flex shrink-0 items-center gap-3 text-[11px]">
                        <span className="text-zinc-500">${Number(offer.price_usd || 0).toFixed(2)}</span>
                        <span className="font-medium text-emerald-400">{offer.quantity_sold} sold</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent orders */}
            {analytics.recent_orders && analytics.recent_orders.length > 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-card p-5">
                <div className="mb-3 text-xs font-bold text-white">Recent Sales</div>
                <div className="space-y-2">
                  {analytics.recent_orders.slice(0, 5).map((order: any) => (
                    <div key={order.id} className="flex items-center justify-between rounded-xl border border-zinc-800/50 bg-zinc-950/50 px-4 py-2.5">
                      <div className="min-w-0">
                        <span className="truncate text-sm text-zinc-300">{order.offer_title}</span>
                        {order.dum_discount && (
                          <span className="ml-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-1.5 py-0.5 text-[8px] font-bold text-emerald-400">DUM</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-[11px]">
                        <span className="font-medium text-white">${order.amount.toFixed(2)}</span>
                        <span className="text-zinc-600">{order.date ? new Date(order.date).toLocaleDateString() : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {analytics.total_orders === 0 && analytics.total_views === 0 && (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-6 text-center">
                <div className="text-sm font-medium text-zinc-400">No activity yet</div>
                <p className="mt-1 text-xs text-zinc-600">Share your storefront links to start getting views and sales</p>
              </div>
            )}
          </div>
        )}

        {bizProfile && analyticsLoading && !analytics && (
          <div className="mb-6 rounded-2xl border border-zinc-800 bg-card p-6 text-center">
            <div className="text-sm text-zinc-500">Loading analytics...</div>
          </div>
        )}

        {/* Next best action */}
        <div className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/20 p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">What to do next</div>
          <div className="space-y-2">
            {projects.length === 0 && (
              <Link href="/build" className="flex items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] px-4 py-3 transition hover:border-emerald-400/30">
                <span className="text-base">🚀</span>
                <div>
                  <div className="text-sm font-bold text-white">Create your first business</div>
                  <div className="text-[11px] text-zinc-500">Earn +25 DUM Points</div>
                </div>
              </Link>
            )}
            {projects.length > 0 && projects.some(p => p.status === "live") && (
              <Link href={`/project/${projects.find(p => p.status === "live")?.id}#offers-section`} className="flex items-center gap-3 rounded-xl border border-zinc-800/30 bg-zinc-950/50 px-4 py-3 transition hover:border-emerald-400/15">
                <span className="text-base">🏷️</span>
                <div>
                  <div className="text-sm font-bold text-white">Add or improve offers</div>
                  <div className="text-[11px] text-zinc-500">Earn +5 DUM Points per offer</div>
                </div>
              </Link>
            )}
            {dumBalance < 50 && (
              <Link href="/" className="flex items-center gap-3 rounded-xl border border-zinc-800/30 bg-zinc-950/50 px-4 py-3 transition hover:border-emerald-400/15">
                <span className="text-base">💡</span>
                <div>
                  <div className="text-sm font-bold text-white">Launch another project</div>
                  <div className="text-[11px] text-zinc-500">Earn +25 DUM Points to reach Builder tier</div>
                </div>
              </Link>
            )}
            <Link href="/discover" className="flex items-center gap-3 rounded-xl border border-zinc-800/30 bg-zinc-950/50 px-4 py-3 transition hover:border-emerald-400/15">
              <span className="text-base">🔍</span>
              <div>
                <div className="text-sm font-bold text-white">Explore & support other businesses</div>
                <div className="text-[11px] text-zinc-500">Earn +2 DUM Points per purchase</div>
              </div>
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
            <span className="text-lg font-bold text-emerald-400">Create Business</span>
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
                <div className="mb-1 text-base font-bold text-white">Create your first business</div>
                <p className="mb-4 text-sm text-zinc-400">Describe what you sell and AI will build your storefront with offers in under 60 seconds.</p>
                <Link
                  href="/build"
                  className="inline-flex items-center rounded-xl bg-emerald-400 px-6 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-300"
                >
                  Start Selling →
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
                      <div className="text-xs text-zinc-500">Copy your storefront link</div>
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
              Your Businesses
            </h2>
            <span className="text-xs text-zinc-700">
              {projects.length} project{projects.length !== 1 ? "s" : ""}
            </span>
          </div>

          {!user ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-8 text-center">
              <p className="text-sm text-zinc-500">Sign in to view your businesses.</p>
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
                        <span className="text-xs text-zinc-600"> </span>
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
