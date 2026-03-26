"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string | null;
  template_type?: string;
  status?: string;
  created_at?: string;
  token_symbol?: string | null;
};

type MarketSnapshot = {
  price: number;
  market_cap: number;
  volume_24h: number;
};

type RecentTrade = {
  id?: number;
  side?: string;
  price?: number;
  token_symbol?: string | null;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
/** Recent trades: GET /api/activity/recent-trades (see backend/api/routes/market.py) */

const TARGET_MARKET_CAP = 100_000;

const DISCOVER_TABS = [
  { id: "movers", label: "🔥 Popular" },
  { id: "new", label: "⚡ New" },
  { id: "live", label: "🟢 Live" },
  { id: "all", label: "All" },
  { id: "ai", label: "AI" },
  { id: "health", label: "Health" },
  { id: "food", label: "Food" },
] as const;

type DiscoverTabId = (typeof DISCOVER_TABS)[number]["id"];

function getProjectEmoji(project: Project, index: number) {
  const source = `${project.title || project.name || ""} ${project.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "💪";
  if (source.includes("math") || source.includes("tutor")) return "🧠";
  if (source.includes("movie") || source.includes("script")) return "🎬";
  if (source.includes("music") || source.includes("beat")) return "🎵";
  if (source.includes("crypto") || source.includes("signal")) return "📈";
  if (source.includes("clean")) return "🧹";

  return ["🚀", "⚡", "🧠", "💡", "📦", "🌐"][index % 6];
}

function getAccent(index: number) {
  const accents = ["#00FFB2", "#FF6B35", "#A78BFA", "#FBBF24", "#38BDF8", "#F472B6"];
  return accents[index % accents.length];
}

function getCategory(project: Project) {
  const source = `${project.title || project.name || ""} ${project.template_type || ""}`.toLowerCase();

  if (source.includes("fitness") || source.includes("health")) return "Health";
  if (source.includes("movie") || source.includes("script")) return "Creative";
  if (source.includes("music") || source.includes("beat")) return "Music";
  if (source.includes("crypto") || source.includes("signal")) return "Finance";
  if (source.includes("clean")) return "Business";
  if (source.includes("math") || source.includes("tutor")) return "Creative";

  return "Business";
}

function matchesFood(project: Project) {
  const s = `${project.title || ""} ${project.name || ""} ${project.description || ""}`.toLowerCase();
  return (
    s.includes("food") ||
    s.includes("grill") ||
    s.includes("recipe") ||
    s.includes("restaurant") ||
    s.includes("kitchen")
  );
}

function matchesAi(project: Project) {
  const s = `${project.template_type || ""} ${project.title || ""} ${project.name || ""}`.toLowerCase();
  return (
    s.includes("ai") ||
    s.includes("assistant") ||
    s.includes("tutor") ||
    s.includes("chat") ||
    s.includes("llm")
  );
}

function tabIncludesProject(project: Project, tab: DiscoverTabId): boolean {
  switch (tab) {
    case "all":
    case "movers":
    case "new":
      return true;
    case "live":
      return (project.status || "live") === "live";
    case "health":
      return getCategory(project) === "Health";
    case "food":
      return matchesFood(project);
    case "ai":
      return matchesAi(project);
    default:
      return true;
  }
}

function getTicker(project: Project) {
  if (project.token_symbol?.trim()) {
    return project.token_symbol.replace(/^\$/, "").toUpperCase().slice(0, 10);
  }
  const raw = (project.title || project.name || "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, 2).toUpperCase())
    .join("")
    .slice(0, 6);

  return raw || "";
}

function getProjectLabel(project?: Project) {
  return project?.title || project?.name || "—";
}

function isToday(dateString?: string) {
  if (!dateString) return false;

  const date = new Date(dateString);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatCompact(n: number) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPrice(n: number) {
  if (!Number.isFinite(n)) return "0.000000";
  return n.toFixed(6);
}

function RelativeCreatedAt({ dateStr }: { dateStr?: string | null }) {
  const [label, setLabel] = useState("—");

  useEffect(() => {
    if (!dateStr) {
      setLabel("—");
      return;
    }
    function update() {
      const t = new Date(dateStr).getTime();
      if (Number.isNaN(t)) {
        setLabel("—");
        return;
      }
      const diff = Date.now() - t;
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      if (mins < 1) setLabel("just now");
      else if (mins < 60) setLabel(`${mins}m ago`);
      else if (hrs < 24) setLabel(`${hrs}h ago`);
      else setLabel(`${Math.floor(hrs / 24)}d ago`);
    }
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [dateStr]);

  return (
    <span className="font-mono text-[9px] text-zinc-700">{label}</span>
  );
}

export default function DiscoverPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const [flashingProjectIds, setFlashingProjectIds] = useState<Record<string, boolean>>({});
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [activeTab, setActiveTab] = useState<DiscoverTabId>("movers");
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [priceFlashDirection, setPriceFlashDirection] = useState<
    Record<string, "up" | "down">
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const marketPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pulseClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadMarketSnapshots(projectIds: string[]) {
    if (!projectIds.length) {
      setMarketByProject({});
      return;
    }

    try {
      const snapshots = await Promise.all(
        projectIds.map(async (projectId) => {
          const res = await fetch(`${API_BASE}/api/projects/${projectId}/market`, {
            cache: "no-store",
          });
          if (!res.ok) return [projectId, null] as const;
          const data = await res.json();
          return [
            projectId,
            {
              price: Number(data?.price || 0),
              market_cap: Number(data?.market_cap || 0),
              volume_24h: Number(data?.volume_24h || 0),
            } satisfies MarketSnapshot,
          ] as const;
        })
      );

      setMarketByProject((prev) => {
        const next: Record<string, MarketSnapshot> = {};
        for (const [projectId, snapshot] of snapshots) {
          if (!snapshot) continue;
          next[projectId] = snapshot;
        }

        for (const [projectId, snapshot] of Object.entries(next)) {
          const oldPrice = prev[projectId]?.price;
          if (oldPrice != null && snapshot.price !== oldPrice) {
            const dir: "up" | "down" =
              snapshot.price > oldPrice ? "up" : "down";
            setPriceFlashDirection((d) => ({ ...d, [projectId]: dir }));
            setFlashingProjectIds((current) => ({ ...current, [projectId]: true }));
            if (flashTimeoutsRef.current[projectId]) {
              clearTimeout(flashTimeoutsRef.current[projectId]);
            }
            flashTimeoutsRef.current[projectId] = setTimeout(() => {
              setFlashingProjectIds((current) => ({ ...current, [projectId]: false }));
              setPriceFlashDirection((d) => {
                const n = { ...d };
                delete n[projectId];
                return n;
              });
            }, 600);
          }
        }

        return next;
      });
    } catch (err) {
      console.error("DISCOVER MARKET LOAD ERROR:", err);
    }
  }

  async function loadProjects() {
    try {
      setLoading(true);
      setError("");

      const res = await fetch(`${API_BASE}/api/projects/public`, {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`Failed to load projects: ${res.status}`);
      }

      const data = await res.json();
      const publicProjects = Array.isArray(data?.projects)
        ? data.projects
        : Array.isArray(data)
        ? data
        : [];

      setProjects(publicProjects);
    } catch (err) {
      console.error("DISCOVER LOAD ERROR:", err);
      setError("Failed to load public projects.");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentTrades() {
    try {
      const res = await fetch(`${API_BASE}/api/activity/recent-trades`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRecentTrades(Array.isArray(data?.trades) ? data.trades : []);
    } catch {
      setRecentTrades([]);
    }
  }

  useEffect(() => {
    loadProjects();
    loadRecentTrades();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadRecentTrades();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const projectIds = projects.map((p) => p.id).filter(Boolean);
    if (!projectIds.length) return;

    loadMarketSnapshots(projectIds);

    if (marketPollRef.current) clearInterval(marketPollRef.current);
    marketPollRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadMarketSnapshots(projectIds);
    }, 15_000);

    return () => {
      if (marketPollRef.current) clearInterval(marketPollRef.current);
    };
  }, [projects]);

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(flashTimeoutsRef.current)) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  /** Weighted synthetic pulse: prefer top movers, then random — bridges low-traffic periods. */
  useEffect(() => {
    if (!projects.length) return;

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

      const liveWithPrice = projects.filter(
        (p) => (p.status || "live") === "live" && (marketByProject[p.id]?.price ?? 0) > 0
      );
      if (!liveWithPrice.length) return;

      const byVol = [...liveWithPrice].sort(
        (a, b) =>
          (marketByProject[b.id]?.volume_24h || 0) - (marketByProject[a.id]?.volume_24h || 0)
      );
      const top3 = byVol.slice(0, 3);

      const pick =
        top3.length && Math.random() < 0.7
          ? top3[Math.floor(Math.random() * top3.length)]
          : liveWithPrice[Math.floor(Math.random() * liveWithPrice.length)];

      setPulseId(pick.id);
      if (pulseClearTimeoutRef.current) clearTimeout(pulseClearTimeoutRef.current);
      pulseClearTimeoutRef.current = setTimeout(() => setPulseId(null), 600);
    }, 2500);

    return () => {
      clearInterval(interval);
      if (pulseClearTimeoutRef.current) clearTimeout(pulseClearTimeoutRef.current);
    };
  }, [projects, marketByProject]);

  const sortedProjects = useMemo(() => {
    let list = projects.filter((p) => tabIncludesProject(p, activeTab));

    if (activeTab === "movers") {
      list = [...list].sort(
        (a, b) =>
          (marketByProject[b.id]?.volume_24h || 0) - (marketByProject[a.id]?.volume_24h || 0)
      );
    } else if (activeTab === "new") {
      list = [...list].sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    } else {
      list = [...list].sort(
        (a, b) =>
          (marketByProject[b.id]?.volume_24h || 0) - (marketByProject[a.id]?.volume_24h || 0)
      );
    }

    return list;
  }, [projects, activeTab, marketByProject]);

  const totalPublicProjects = projects.length;
  const newestProject = projects[0];
  const newTodayCount = projects.filter((p) => isToday(p.created_at)).length;
  const totalVolume24h = useMemo(() => {
    return Object.values(marketByProject).reduce(
      (sum, m) => sum + (Number.isFinite(m.volume_24h) ? m.volume_24h : 0),
      0
    );
  }, [marketByProject]);

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Live activity strip */}
      <div className="border-b border-zinc-900 bg-zinc-950/50 py-2">
        {recentTrades.length === 0 ? (
          <p className="text-center font-mono text-[10px] text-zinc-600">
            No recent activity yet.
          </p>
        ) : (
          <div className="overflow-hidden">
            <div className="home-marquee-track gap-6">
              {recentTrades.concat(recentTrades).map((trade, i) => {
                const sym = trade.token_symbol || "—";
                return (
                  <span
                    key={`d-${i}`}
                    className="flex shrink-0 items-center font-mono text-[10px]"
                  >
                    <span className="text-zinc-600">◆</span>
                    <span className="ml-1 text-zinc-400">{sym}</span>
                    <span className="ml-2 text-zinc-800">·</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-600">
          ◆ Discovery Feed
        </div>

        <div className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="font-mono text-4xl font-bold uppercase tracking-[-0.04em] text-white sm:text-6xl">
              Available Services
            </h1>
          </div>
        </div>

        <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1">
          {DISCOVER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 rounded-lg px-4 py-2 font-mono text-[10px] uppercase tracking-[0.1em] transition ${
                activeTab === tab.id
                  ? "bg-emerald-400 font-bold text-black"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mb-8 flex flex-wrap gap-4 border border-zinc-900 bg-zinc-950/50 px-4 py-5 sm:px-6">
          <div className="min-w-[140px] flex-1">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Public projects
            </div>
            <div className="font-mono text-2xl font-bold text-white">{totalPublicProjects}</div>
          </div>
          <div className="min-w-[140px] flex-1 border-l border-zinc-800 pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Activity
            </div>
            <div className="font-mono text-2xl font-bold text-emerald-400/90">
              {totalVolume24h >= 1e6
                ? `${(totalVolume24h / 1e6).toFixed(2)}M`
                : totalVolume24h.toFixed(0)}
            </div>
          </div>
          <div className="min-w-[140px] flex-1 border-l border-zinc-800 pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Newest
            </div>
            <div className="line-clamp-2 font-mono text-sm font-semibold text-zinc-200">
              {getProjectLabel(newestProject)}
            </div>
          </div>
          <div className="min-w-[100px] flex-1 border-l border-zinc-800 pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              New today
            </div>
            <div className="font-mono text-2xl font-bold text-white">{newTodayCount}</div>
          </div>
        </div>

        {loading ? (
          <div className="border border-zinc-900 bg-zinc-950 p-8 text-zinc-400">
            Loading public projects...
          </div>
        ) : error ? (
          <div className="border border-red-500/20 bg-red-500/10 p-8 text-red-300">
            {error}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="border border-zinc-900 bg-zinc-950 p-8 text-zinc-400">
            No public projects match this tab.
          </div>
        ) : (
          <div className="grid gap-0 border border-zinc-900 md:grid-cols-2 xl:grid-cols-3">
            {sortedProjects.map((project, index) => {
              const accent = getAccent(index);
              const emoji = getProjectEmoji(project, index);
              const category = getCategory(project);
              const ticker = getTicker(project);
              const snap = marketByProject[project.id];
              const price = snap?.price;
              const flash = flashingProjectIds[project.id];
              const pulsing = pulseId === project.id;
              const mcap = snap?.market_cap ?? 0;
              const barPct = Math.min((mcap / TARGET_MARKET_CAP) * 100, 100);

              return (
                <Link key={project.id} href={`/project/${project.id}`}>
                  <div
                    className={`h-full rounded-2xl border bg-black p-6 transition-all duration-300 md:p-7 ${
                      pulsing
                        ? "card-pulse border-emerald-400/60 shadow-[0_0_12px_rgba(52,211,153,0.15)]"
                        : "border-zinc-900 hover:border-emerald-400/20"
                    }`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div style={{ fontSize: "36px" }}>{emoji}</div>

                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="relative flex h-2 w-2">
                            <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                          </span>
                          <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-500">
                            LIVE
                          </span>
                        </div>
                        <div
                          className="mt-1 font-mono text-lg font-bold uppercase"
                          style={{ color: accent }}
                        >
                          ${ticker}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                          {project.status || "live"}
                        </div>
                        <div className="mt-1">
                          <RelativeCreatedAt dateStr={project.created_at} />
                        </div>
                        <div
                          className={`mt-2 inline-block font-mono text-2xl font-black tabular-nums transition-all duration-200 ${
                            flash && priceFlashDirection[project.id] === "down"
                              ? "price-flash scale-105 text-red-300"
                              : pulsing || flash
                              ? "price-flash scale-105 text-emerald-300"
                              : "text-white"
                          }`}
                        >
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">
                          Credits issued
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {snap?.market_cap != null ? formatCompact(snap.market_cap) : "—"}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all duration-1000"
                          style={{
                            width: `${barPct}%`,
                            minWidth: mcap > 0 ? "4px" : "0",
                          }}
                        />
                      </div>
                    </div>

                    <h3 className="mt-4 font-mono text-xl font-bold leading-snug text-white md:text-2xl">
                      {project.title || project.name || "Untitled Project"}
                    </h3>

                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-zinc-500">
                      {project.description || "No description yet."}
                    </p>

                    <div className="mt-6 flex items-center justify-between gap-3 border-t border-zinc-900 pt-4">
                      <span className="text-xs text-zinc-600">View service →</span>

                      <span
                        className="border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]"
                        style={{
                          borderColor: accent,
                          color: accent,
                        }}
                      >
                        {category}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
