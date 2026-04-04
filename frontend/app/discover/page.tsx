"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Starfield } from "../../components/Starfield";

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string | null;
  template_type?: string;
  status?: string;
  created_at?: string;
  token_symbol?: string | null;
  token_utility?: string | null;
  promo_copy?: string | null;
  store_items?: any[] | null;
  owner_verified?: boolean;
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
  { id: "new", label: "⚡ New" },
  { id: "top", label: "🏆 Popular" },
  { id: "live", label: "🟢 Live" },
  { id: "offers", label: "🛒 Has Offers" },
  { id: "business", label: "💼 Business" },
  { id: "gaming", label: "🎮 Entertainment" },
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

function matchesGaming(project: Project): boolean {
  const s = `${project.title || ""} ${project.name || ""} ${project.description || ""}`.toLowerCase();
  return s.includes("game") || s.includes("arcade") || s.includes("play") || s.includes("tetris") || s.includes("snake") || s.includes("puzzle") || s.includes("pong") || s.includes("quiz");
}

function getCategory(project: Project) {
  const source = `${project.title || project.name || ""} ${project.template_type || ""} ${project.description || ""}`.toLowerCase();

  if (source.includes("game") || source.includes("arcade") || source.includes("tetris") || source.includes("snake") || source.includes("pong") || source.includes("quiz")) return "Entertainment";
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

function hasOffers(project: Project): boolean {
  return Array.isArray(project.store_items) && project.store_items.length > 0;
}

function hasSubscription(project: Project): boolean {
  return Array.isArray(project.store_items) && project.store_items.some((i: any) => i.type === "subscription");
}

function offerCount(project: Project): number {
  return Array.isArray(project.store_items) ? project.store_items.length : 0;
}

function lowestOfferPrice(project: Project): number | null {
  if (!Array.isArray(project.store_items) || project.store_items.length === 0) return null;
  const prices = project.store_items
    .map((i: any) => Number(i.price_usd ?? i.price ?? 0))
    .filter((p) => p > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
}

function isPlaceholderDesc(d?: string | null): boolean {
  if (!d?.trim()) return true;
  const lower = d.trim().toLowerCase();
  return lower.startsWith("auto-created") || lower.startsWith("project workspace");
}

function tabIncludesProject(project: Project, tab: DiscoverTabId): boolean {
  switch (tab) {
    case "all":
    case "new":
    case "top":
      return true;
    case "live":
      return (project.status || "live") === "live";
    case "offers":
      return hasOffers(project);
    case "business":
      return hasOffers(project) && !isPlaceholderDesc(project.description);
    case "gaming":
      return matchesGaming(project);
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

/* ─── Discover Section Nav ─── */
const DISCOVER_NAV = [
  { id: "section-top", label: "Trending" },
  { id: "section-grid", label: "Projects" },
];

function DiscoverSectionNav() {
  const [active, setActive] = useState("");

  useEffect(() => {
    const ids = DISCOVER_NAV.filter((s) => document.getElementById(s.id)).map((s) => s.id);
    if (ids.length < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -50% 0px", threshold: 0 }
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
  };

  return (
    <nav className="fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 lg:flex">
      <div className="flex flex-col items-end gap-2.5 rounded-2xl border border-zinc-800/40 bg-zinc-950/80 px-2.5 py-3 backdrop-blur-sm">
        {DISCOVER_NAV.map((s) => {
          const isActive = active === s.id;
          return (
            <button key={s.id} onClick={() => scrollTo(s.id)} className="flex items-center gap-2 transition-all duration-200">
              <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-200 ${isActive ? "text-emerald-400" : "text-zinc-600 hover:text-zinc-400"}`}>
                {s.label}
              </span>
              <span className={`block shrink-0 rounded-full transition-all duration-300 ${isActive ? "h-2.5 w-2.5 bg-emerald-400 shadow-[0_0_8px_rgba(0,255,163,0.5)]" : "h-1.5 w-1.5 bg-zinc-700"}`} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function DiscoverPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const [flashingProjectIds, setFlashingProjectIds] = useState<Record<string, boolean>>({});
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [activeTab, setActiveTab] = useState<DiscoverTabId>("new");
  const [searchQuery, setSearchQuery] = useState("");
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

  function projectReadinessScore(p: Project): number {
    let s = 0;
    if (p.description && p.description.length > 20) s += 20;
    if (p.token_utility && p.token_utility.length > 10) s += 20;
    if (p.promo_copy && p.promo_copy.length > 10) s += 20;
    if (hasOffers(p)) s += 20;
    if (hasSubscription(p)) s += 10;
    if ((marketByProject[p.id]?.volume_24h || 0) > 0) s += 10;
    // Verified businesses rank higher
    if (p.owner_verified) s += 15;
    return s;
  }

  const sortedProjects = useMemo(() => {
    let list = projects.filter((p) => tabIncludesProject(p, activeTab));

    if (activeTab === "new") {
      list = [...list].sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    } else if (activeTab === "top") {
      list = [...list].sort(
        (a, b) => projectReadinessScore(b) - projectReadinessScore(a)
      );
    } else {
      list = [...list].sort(
        (a, b) =>
          (marketByProject[b.id]?.volume_24h || 0) - (marketByProject[a.id]?.volume_24h || 0)
      );
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          (p.title || p.name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [projects, activeTab, marketByProject, searchQuery]);

  const totalPublicProjects = projects.length;
  const newestProject = projects[0];
  const newTodayCount = projects.filter((p) => isToday(p.created_at)).length;
  const totalVolume24h = useMemo(() => {
    return Object.values(marketByProject).reduce(
      (sum, m) => sum + (Number.isFinite(m.volume_24h) ? m.volume_24h : 0),
      0
    );
  }, [marketByProject]);

  // Global ranking by readiness score
  const rankedProjects = useMemo(() => {
    return [...projects]
      .map((p) => ({ ...p, readiness: projectReadinessScore(p) }))
      .sort((a, b) => b.readiness - a.readiness);
  }, [projects, marketByProject]);

  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    rankedProjects.forEach((p, i) => { map[p.id] = i + 1; });
    return map;
  }, [rankedProjects]);

  return (
    <main className="relative min-h-screen bg-base text-white">
      <Starfield count={100} />
      <DiscoverSectionNav />
      {/* Branded activity strip */}
      <div className="border-b border-zinc-900 bg-zinc-950/50 py-2">
        <p className="text-center font-mono text-[10px] text-zinc-500">
          <span className="text-emerald-400">↑</span>{" "}
          <span className="font-bold text-emerald-400/80">DUM</span>{" "}
          <span className="text-zinc-700">·</span>{" "}
          Activity rising{" "}
          <span className="text-zinc-700">·</span>{" "}
          Businesses going live on DUM Club
        </p>
      </div>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div id="section-top" className="mb-6">
          <div className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-600">
            ◆ DUM Club · Digital Utility Market
          </div>
          <h1 className="text-3xl font-bold uppercase tracking-[-0.04em] text-white sm:text-5xl">
            Live Businesses
          </h1>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-2 text-[12px] text-emerald-400/80">
            <span>◆</span> DUM Points earned here work at every business on the platform
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search businesses..."
            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-emerald-400/40 sm:max-w-xs"
          />
        </div>

        <div id="section-filters" className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-1">
          {DISCOVER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-shrink-0 rounded-lg px-4 py-2 text-xs uppercase tracking-[0.1em] transition ${
                activeTab === tab.id
                  ? "bg-emerald-400 font-bold text-black"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 border border-zinc-900 bg-zinc-950/50 px-4 py-5 sm:flex sm:flex-wrap sm:px-6">
          <div className="min-w-[140px] flex-1">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Live businesses
            </div>
            <div className="font-mono text-2xl font-bold text-white">{totalPublicProjects}</div>
          </div>
          <div className="min-w-[140px] flex-1 sm:border-l sm:border-zinc-800 sm:pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              With offers
            </div>
            <div className="font-mono text-2xl font-bold text-emerald-400/90">
              {projects.filter((p) => hasOffers(p)).length}
            </div>
          </div>
          <div className="min-w-[140px] flex-1 sm:border-l sm:border-zinc-800 sm:pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
              Newest
            </div>
            <div className="line-clamp-2 text-sm font-semibold text-zinc-200">
              {getProjectLabel(newestProject)}
            </div>
          </div>
          {newTodayCount > 0 && (
            <div className="min-w-[100px] flex-1 sm:border-l sm:border-zinc-800 sm:pl-4 sm:pl-6">
              <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                New today
              </div>
              <div className="font-mono text-2xl font-bold text-white">{newTodayCount}</div>
            </div>
          )}
        </div>

        {/* Leaderboard strip */}
        {rankedProjects.length > 0 && (
          <div className="mb-8 rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400/60">
                Top Businesses
              </span>
              <Link
                href="/leaderboard"
                className="text-[11px] font-medium text-zinc-500 transition hover:text-emerald-400"
              >
                View Leaderboard →
              </Link>
            </div>
            <div className="space-y-1">
              {rankedProjects.slice(0, 5).map((p, i) => {
                const rsColor = p.readiness >= 75 ? "text-emerald-400" : p.readiness >= 50 ? "text-amber-400" : "text-zinc-500";
                return (
                  <Link key={p.id} href={`/project/${p.id}`}>
                    <div className="flex items-center gap-4 rounded-xl px-3 py-2.5 transition hover:bg-zinc-900">
                      <span className="w-6 text-center font-mono text-sm font-bold text-zinc-600">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-sm font-medium text-white">
                        {p.title || p.name || "Untitled"}
                      </span>
                      {/* token symbol hidden — DUM Points system */}
                      <span className={`font-mono text-sm font-bold ${rsColor}`}>
                        {p.readiness}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div id="section-grid">
        {loading ? (
          <div className="border border-zinc-900 bg-zinc-950 p-8 text-zinc-400">
            Loading public projects...
          </div>
        ) : error ? (
          <div className="border border-red-500/20 bg-red-500/10 p-8 text-red-300">
            {error}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="border border-zinc-900 bg-zinc-950 p-8 text-center">
            {searchQuery.trim() ? (
              <div>
                <p className="text-zinc-400">No results for &quot;{searchQuery}&quot;</p>
                <button onClick={() => setSearchQuery("")} className="mt-3 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-emerald-400/30 hover:text-emerald-400">
                  Clear search
                </button>
              </div>
            ) : (
              <div>
                <p className="text-zinc-400">No businesses in this category yet.</p>
                <Link href="/build" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-300">
                  Be the first — Create a business →
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-0 border border-zinc-900 md:grid-cols-2 xl:grid-cols-3">
            {sortedProjects.map((project, index) => {
              const accent = getAccent(index);
              const emoji = getProjectEmoji(project, index);
              const category = getCategory(project);
              const pulsing = pulseId === project.id;

              return (
                <Link key={project.id} href={`/project/${project.id}`} className="group">
                  <div
                    className={`h-full rounded-2xl border bg-card p-6 transition-all duration-300 md:p-7 ${
                      pulsing
                        ? "card-pulse border-emerald-400/60 shadow-[0_0_16px_rgba(52,211,153,0.15)]"
                        : "border-zinc-800/80 hover:border-zinc-700 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
                    }`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <div style={{ fontSize: "36px" }}>{emoji}</div>
                        {(() => {
                          const rank = rankMap[project.id];
                          if (!rank) return null;
                          const label = rank <= 3 ? `#${rank} Trending` : rank <= 10 ? "Top 10" : rank <= 50 ? "Top 50" : null;
                          if (!label) return null;
                          const cls = rank <= 3
                            ? "border-emerald-400/30 text-emerald-400"
                            : rank <= 10
                            ? "border-amber-400/30 text-amber-400"
                            : "border-zinc-700 text-zinc-500";
                          return (
                            <span className={`mt-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${cls}`}>
                              {label}
                            </span>
                          );
                        })()}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-500">
                          LIVE
                        </span>
                        <span
                          className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.1em]"
                          style={{ borderColor: accent, color: accent }}
                        >
                          {category}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-xl font-bold leading-snug text-white md:text-2xl">
                      {project.title || project.name || "Untitled Project"}
                    </h3>

                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-zinc-500">
                      {project.description || "No description yet."}
                    </p>

                    {/* Badges row: offers, subscription, utility */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {hasOffers(project) && (
                        <span className="rounded-full border border-sky-400/20 bg-sky-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-sky-400">
                          {offerCount(project)} offer{offerCount(project) > 1 ? "s" : ""}
                        </span>
                      )}
                      {hasSubscription(project) && (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-400">
                          Subscription
                        </span>
                      )}
                      {/* Perks badge removed — universal, adds noise */}
                      {project.promo_copy && (
                        <span className="rounded-full border border-amber-400/20 bg-amber-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-amber-400">
                          Promo
                        </span>
                      )}
                    </div>

                    {/* Readiness score bar */}
                    {(() => {
                      const rs = projectReadinessScore(project);
                      const rsColor = rs >= 75 ? "bg-emerald-400" : rs >= 50 ? "bg-amber-400" : "bg-zinc-600";
                      const rsText = rs >= 75 ? "text-emerald-400" : rs >= 50 ? "text-amber-400" : "text-zinc-600";
                      return (
                        <div className="mt-4">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[9px] uppercase tracking-widest text-zinc-600">
                              Profile strength
                            </span>
                            <span className={`font-mono text-[10px] font-bold ${rsText}`}>
                              {rs}/100
                            </span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-900">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${rsColor}`}
                              style={{ width: `${rs}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}

                    <div className="mt-5 flex items-center justify-between gap-3 border-t border-zinc-800/60 pt-4">
                      <span className="text-xs font-medium text-zinc-400 transition group-hover:text-emerald-400">
                        {hasOffers(project) ? "View Offers →" : "View Project →"}
                      </span>
                      <div className="flex items-center gap-2">
                        {(() => {
                          const price = lowestOfferPrice(project);
                          if (price == null) return null;
                          return (
                            <span className="text-sm font-bold text-emerald-400">
                              From ${price < 1 ? price.toFixed(2) : Math.round(price)}
                            </span>
                          );
                        })()}
                        <RelativeCreatedAt dateStr={project.created_at} />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        </div>
      </section>
    </main>
  );
}
