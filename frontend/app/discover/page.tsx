"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Starfield } from "../../components/Starfield";
import { CATEGORIES, classifyProject, type CategoryId } from "../../lib/categories";

const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), { ssr: false });

type Project = {
  id: string;
  slug?: string | null;
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
  verified?: boolean;
  is_verified?: boolean;
  profile_strength?: number | null;
  sort_order?: number | null;
  is_live?: boolean;
  live_playback_id?: string | null;
  live_provider?: string | null;
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

import { API_BASE } from "../../lib/apiBase";
/** Recent trades: GET /api/activity/recent-trades (see backend/api/routes/market.py) */

const TARGET_MARKET_CAP = 100_000;

/**
 * Unified category filter (v5.0). Categories come from the shared
 * taxonomy in frontend/lib/categories.ts so the homepage and the
 * discover filter bar agree on labels, icons, and classification
 * rules. "All" is prepended locally because it's a discover-only
 * filter state (not a category a project can belong to).
 *
 * Sort / live / deals / price are independent filter state declared
 * directly on the DiscoverPage component.
 *
 * Topgun lands in "aviation" via classifyProject() — the shared
 * keyword categorizer from lib/categories.ts.
 */
type DiscoverCategoryId = "all" | CategoryId;

type DiscoverCategoryDef = {
  readonly id: DiscoverCategoryId;
  readonly label: string;
  readonly icon: string;
};

const DISCOVER_CATEGORIES: readonly DiscoverCategoryDef[] = [
  { id: "all", label: "All", icon: "◎" },
  ...CATEGORIES.map((c) => ({ id: c.key, label: c.label, icon: c.icon })),
];

type DiscoverSortId = "newest" | "popular" | "priceAsc" | "priceDesc" | "nearest";

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

function categoryIncludesProject(project: Project, category: DiscoverCategoryId): boolean {
  if (category === "all") return true;
  return classifyProject(project) === category;
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

/* ─── Live Now Section — Multi-stream Preview ─── */
function LiveNowSection({ projects }: { projects: Project[] }) {
  const liveProjects = projects.filter((p) => p.is_live);

  if (liveProjects.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </span>
        <h2 className="text-lg font-bold uppercase tracking-[0.15em] text-white">Live Now</h2>
        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-400">
          {liveProjects.length}
        </span>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory" }}>
        {liveProjects.map((project, index) => {
          const emoji = getProjectEmoji(project, index);
          const category = getCategory(project);
          const accent = getAccent(index);

          return (
            <Link
              key={project.id}
              href={`/project/${project.slug || project.id}?live=1`}
              className="flex-shrink-0 cursor-pointer rounded-2xl border border-zinc-800 transition-all duration-300 hover:border-red-500/30 hover:shadow-[0_0_20px_rgba(239,68,68,0.1)]"
              style={{ width: 300, scrollSnapAlign: "start" }}
            >
              {/* Thumbnail */}
              <div className="relative overflow-hidden rounded-t-2xl bg-zinc-900" style={{ aspectRatio: "16/9" }}>
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-5xl">{emoji}</span>
                </div>

                {/* LIVE pill */}
                <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-white">Live</span>
                </div>

                {/* Tap to join */}
                <div className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white backdrop-blur-sm">
                  Tap to join
                </div>
              </div>

              {/* Card info */}
              <div className="rounded-b-2xl bg-zinc-950 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{emoji}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-white">
                      {project.title || project.name || "Untitled"}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                      <span style={{ color: accent }}>{category}</span>
                      <span className="text-emerald-400/60">Earn DUM</span>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const [flashingProjectIds, setFlashingProjectIds] = useState<Record<string, boolean>>({});
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [activeCategory, setActiveCategory] = useState<DiscoverCategoryId>("all");
  const [sortBy, setSortBy] = useState<DiscoverSortId>("newest");
  const [liveOnly, setLiveOnly] = useState(false);
  const [dealsOnly, setDealsOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState<"any" | "under25" | "under50" | "under100" | "over100">("any");
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
  const [reviewSummaries, setReviewSummaries] = useState<Record<string, { count: number; average_rating: number }>>({});
  const [searchArrival, setSearchArrival] = useState(false);
  const [suggestSent, setSuggestSent] = useState(false);
  const [suggestName, setSuggestName] = useState("");

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

  function submitSuggestion(name: string) {
    if (!name.trim()) return;
    // Store locally — backend can read these later
    const existing = JSON.parse(localStorage.getItem("dum_suggestions") || "[]");
    existing.push({ name: name.trim(), query: searchQuery, ts: Date.now() });
    localStorage.setItem("dum_suggestions", JSON.stringify(existing.slice(-50)));
    setSuggestSent(true);
  }

  useEffect(() => {
    loadProjects();
    loadRecentTrades();
    // Read search query + category from URL for homepage routing.
    // ?q=<term> sets the search input, ?category=<id> pre-selects a
    // category pill. Both are additive — you can land on
    // /discover?q=pizza&category=restaurants and both apply.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q");
      const cat = params.get("category") as DiscoverCategoryId | null;
      if (q) {
        setSearchQuery(q);
        setSearchArrival(true);
      }
      if (cat && DISCOVER_CATEGORIES.some((c) => c.id === cat)) {
        setActiveCategory(cat);
      }
    }
  }, []);

  // Review summaries disabled until reviews table is created in production
  // useEffect(() => {
  //   if (!projects.length) return;
  //   Promise.all(
  //     projects.map(async (p) => {
  //       try {
  //         const res = await fetch(`${API_BASE}/api/reviews/summary/${p.id}`);
  //         if (!res.ok) return null;
  //         const data = await res.json();
  //         return { id: p.id, count: data.count || 0, average_rating: data.average_rating || 0 };
  //       } catch { return null; }
  //     })
  //   ).then((results) => {
  //     const map: Record<string, { count: number; average_rating: number }> = {};
  //     for (const r of results) {
  //       if (r && r.count > 0) map[r.id] = { count: r.count, average_rating: r.average_rating };
  //     }
  //     setReviewSummaries(map);
  //   });
  // }, [projects]);

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
    }, 45_000);

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
    }, 6000);

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
    // 1. Category filter (unified replacement for the old tab row)
    let list = projects.filter((p) => categoryIncludesProject(p, activeCategory));

    // 2. Live Now toggle — only streaming merchants
    if (liveOnly) {
      list = list.filter((p) => p.is_live === true);
    }

    // 3. Deals Only toggle — projects with at least one offer that has
    // a discount or "deal" signal. Until we have a proper discount flag
    // on offers, we approximate with presence of any active offer (the
    // v5.0 founding-merchant free tier IS the deal today).
    if (dealsOnly) {
      list = list.filter((p) => hasOffers(p));
    }

    // 4. Price filter (uses project.store_items lowest price as proxy
    // for the cheapest thing you could buy from this merchant)
    if (priceFilter !== "any") {
      list = list.filter((p) => {
        const low = lowestOfferPrice(p);
        if (low == null) return false;
        if (priceFilter === "under25") return low < 25;
        if (priceFilter === "under50") return low < 50;
        if (priceFilter === "under100") return low < 100;
        if (priceFilter === "over100") return low >= 100;
        return true;
      });
    }

    // 5. Sort (from the dropdown)
    if (sortBy === "newest") {
      list = [...list].sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    } else if (sortBy === "popular") {
      list = [...list].sort(
        (a, b) => projectReadinessScore(b) - projectReadinessScore(a)
      );
    } else if (sortBy === "priceAsc") {
      list = [...list].sort((a, b) => {
        const la = lowestOfferPrice(a);
        const lb = lowestOfferPrice(b);
        if (la == null && lb == null) return 0;
        if (la == null) return 1;
        if (lb == null) return -1;
        return la - lb;
      });
    } else if (sortBy === "priceDesc") {
      list = [...list].sort((a, b) => {
        const la = lowestOfferPrice(a);
        const lb = lowestOfferPrice(b);
        if (la == null && lb == null) return 0;
        if (la == null) return 1;
        if (lb == null) return -1;
        return lb - la;
      });
    } else {
      // "nearest" — no-op for now, geolocation lands in Phase 1. Fall
      // through to volume_24h as a reasonable stand-in.
      list = [...list].sort(
        (a, b) =>
          (marketByProject[b.id]?.volume_24h || 0) - (marketByProject[a.id]?.volume_24h || 0)
      );
    }

    // 6. Live projects float to top in every tab (same as before)
    list = [...list].sort((a, b) => (b.is_live ? 1 : 0) - (a.is_live ? 1 : 0));

    // 7. Pinned projects (sort_order non-null) float above everything,
    // ascending (0 = highest priority). Founding merchant pinning.
    list = [...list].sort((a, b) => {
      const aPinned = a.sort_order != null;
      const bPinned = b.sort_order != null;
      if (aPinned && bPinned) return (a.sort_order as number) - (b.sort_order as number);
      if (aPinned) return -1;
      if (bPinned) return 1;
      return 0;
    });

    // 8. Search filter — project name/description match
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (p) =>
          (p.title || p.name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.token_utility || "").toLowerCase().includes(q)
      );
    }

    return list;
  }, [projects, activeCategory, sortBy, liveOnly, dealsOnly, priceFilter, marketByProject, searchQuery]);

  /**
   * Smart-search result sections (v5.0). When a search query is active,
   * sortedProjects gets split into three independent buckets:
   *   - liveNowResults   — matching merchants currently streaming
   *   - businessResults  — matching merchant storefronts (not live)
   *   - offerSearchResults — individual offers fetched from the
   *                        /api/offers/search endpoint (real offers
   *                        table, not store_items JSONB). This lights
   *                        up Topgun's 6 aviation services seeded via
   *                        migration 031.
   * Each section is rendered independently with its own header; empty
   * sections collapse rather than showing "no results".
   */
  const liveNowResults = useMemo(() => {
    return sortedProjects.filter((p) => p.is_live === true);
  }, [sortedProjects]);

  const businessResults = useMemo(() => {
    return sortedProjects.filter((p) => p.is_live !== true);
  }, [sortedProjects]);

  type ItemResult = {
    id?: string;
    projectId: string;
    projectSlug?: string | null;
    projectName: string;
    title: string;
    description?: string;
    price: number | null;
  };

  // Offers fetched from the backend /api/offers/search endpoint.
  // Debounced 300ms so we don't hammer the API on every keystroke.
  const [offerSearchResults, setOfferSearchResults] = useState<ItemResult[]>([]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setOfferSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/offers/search?q=${encodeURIComponent(q)}&limit=20`,
          { signal: controller.signal, cache: "no-store" }
        );
        if (!res.ok) {
          setOfferSearchResults([]);
          return;
        }
        const data = await res.json();
        const rows: ItemResult[] = (Array.isArray(data) ? data : []).map((o: any) => {
          const rawPrice = o?.price_usd;
          const price =
            typeof rawPrice === "number"
              ? rawPrice
              : rawPrice != null && Number.isFinite(Number(rawPrice))
                ? Number(rawPrice)
                : null;
          return {
            id: o?.id,
            projectId: o?.project_id,
            projectSlug: o?.project_slug ?? null,
            projectName: o?.project_name || "Business",
            title: o?.title || "",
            description: o?.description || "",
            price,
          };
        });
        setOfferSearchResults(rows);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("[discover] offer search failed:", err);
          setOfferSearchResults([]);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  // Respect the price filter client-side so the Items for Sale
  // section stays in sync with the toolbar filter applied to
  // Services & Businesses.
  const itemResults = useMemo<ItemResult[]>(() => {
    if (priceFilter === "any") return offerSearchResults;
    return offerSearchResults.filter((item) => {
      if (item.price == null) return false;
      if (priceFilter === "under25") return item.price < 25;
      if (priceFilter === "under50") return item.price < 50;
      if (priceFilter === "under100") return item.price < 100;
      if (priceFilter === "over100") return item.price >= 100;
      return true;
    });
  }, [offerSearchResults, priceFilter]);

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
      <Starfield count={50} />
      <DiscoverSectionNav />
      {/* Branded activity strip */}
      <div className="border-b border-zinc-900 bg-zinc-950/50 py-2">
        <p className="text-center font-mono text-[10px] text-zinc-500">
          <span className="text-emerald-400">↑</span>{" "}
          <span className="font-bold text-emerald-400/80">DUM</span>{" "}
          <span className="text-zinc-700">·</span>{" "}
          Activity rising{" "}
          <span className="text-zinc-700">·</span>{" "}
          Activity happening on DUM Club
        </p>
      </div>

      <section className="mx-auto max-w-7xl px-6 py-10">
        <div id="section-top" className="mb-6">
          <div className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-400">
            ◆ DUM Club · Digital Utility Market
          </div>
          <h1 className="neon-emerald text-3xl font-bold uppercase tracking-[-0.04em] text-white sm:text-5xl">
            Live Marketplace
          </h1>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] px-4 py-2 text-[12px] text-emerald-400">
            <span>◆</span> DUM Points earned here work at every business on the platform
          </div>
          {searchArrival && searchQuery.trim() && (
            <p className="mt-3 text-[11px] tracking-[0.1em] text-zinc-600">Sell anything. Buy anything. Reward everyone.</p>
          )}
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

        {/* ── LOCATION BADGE ─────────────────────────────────────
             Static "Morris County, NJ" for Phase 0B. Phase 1 swaps
             this for real geolocation. Visible presence signals that
             DUM Club is a LOCAL discovery platform. */}
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.15em] text-zinc-500">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          Near: Morris County, NJ
        </div>

        {/* ── UNIFIED CATEGORY FILTER PILLS ─────────────────────
             Replaces the old tab row. Single source of truth for
             category selection. Horizontal scroll on mobile. */}
        <div id="section-filters" className="mb-4 flex gap-1.5 overflow-x-auto rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-1.5 backdrop-blur-sm">
          {DISCOVER_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition ${
                activeCategory === cat.id
                  ? "bg-emerald-400 text-black shadow-[0_0_20px_rgba(0,255,163,0.35)]"
                  : "text-zinc-300 hover:text-white"
              }`}
            >
              <span aria-hidden="true">{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>

        {/* ── FILTER BAR: sort + price + toggles ─────────────── */}
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-700/50 bg-zinc-900/60 px-4 py-3 backdrop-blur-sm">
          {/* Sort by */}
          <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-zinc-400">
            Sort
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as DiscoverSortId)}
              className="rounded-lg border border-zinc-600/50 bg-zinc-800/80 px-2 py-1.5 text-[12px] text-zinc-200 outline-none transition hover:border-emerald-400/40 focus:border-emerald-400/60"
            >
              <option value="newest">Newest</option>
              <option value="popular">Most Popular</option>
              <option value="priceAsc">Price: Low → High</option>
              <option value="priceDesc">Price: High → Low</option>
              <option value="nearest">Nearest</option>
            </select>
          </label>

          {/* Price */}
          <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.15em] text-zinc-400">
            Price
            <select
              value={priceFilter}
              onChange={(e) => setPriceFilter(e.target.value as typeof priceFilter)}
              className="rounded-lg border border-zinc-600/50 bg-zinc-800/80 px-2 py-1.5 text-[12px] text-zinc-200 outline-none transition hover:border-emerald-400/40 focus:border-emerald-400/60"
            >
              <option value="any">Any</option>
              <option value="under25">Under $25</option>
              <option value="under50">Under $50</option>
              <option value="under100">Under $100</option>
              <option value="over100">$100+</option>
            </select>
          </label>

          {/* Live Now toggle */}
          <button
            type="button"
            onClick={() => setLiveOnly((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition ${
              liveOnly
                ? "border-red-400/50 bg-red-400/15 text-red-400 shadow-[0_0_16px_rgba(248,113,113,0.2)]"
                : "border-zinc-600/50 text-zinc-300 hover:border-emerald-400/40 hover:text-white"
            }`}
          >
            <span className="relative flex h-1.5 w-1.5">
              {liveOnly && (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                </>
              )}
              {!liveOnly && <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-zinc-500" />}
            </span>
            Live Now
          </button>

          {/* Deals Only toggle */}
          <button
            type="button"
            onClick={() => setDealsOnly((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition ${
              dealsOnly
                ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-400 shadow-[0_0_16px_rgba(0,255,163,0.2)]"
                : "border-zinc-600/50 text-zinc-300 hover:border-emerald-400/40 hover:text-white"
            }`}
          >
            Deals Only
          </button>

          {/* Reset (only when at least one filter is active) */}
          {(activeCategory !== "all" || sortBy !== "newest" || priceFilter !== "any" || liveOnly || dealsOnly) && (
            <button
              type="button"
              onClick={() => {
                setActiveCategory("all");
                setSortBy("newest");
                setPriceFilter("any");
                setLiveOnly(false);
                setDealsOnly(false);
              }}
              className="ml-auto rounded-lg px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-zinc-400 transition hover:text-white"
            >
              Reset
            </button>
          )}
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 rounded-2xl border border-zinc-700/50 bg-zinc-900/60 px-4 py-5 backdrop-blur-sm sm:flex sm:flex-wrap sm:px-6">
          <div className="min-w-[140px] flex-1">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-400">
              Live businesses
            </div>
            <div className="font-mono text-2xl font-bold text-white">{totalPublicProjects}</div>
          </div>
          <div className="min-w-[140px] flex-1 sm:border-l sm:border-zinc-700/50 sm:pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-400">
              With offers
            </div>
            <div className="neon-emerald font-mono text-2xl font-bold text-emerald-400">
              {projects.filter((p) => hasOffers(p)).length}
            </div>
          </div>
          <div className="min-w-[140px] flex-1 sm:border-l sm:border-zinc-700/50 sm:pl-4 sm:pl-6">
            <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-400">
              Newest
            </div>
            <div className="line-clamp-2 text-sm font-semibold text-zinc-200">
              {getProjectLabel(newestProject)}
            </div>
          </div>
          {newTodayCount > 0 && (
            <div className="min-w-[100px] flex-1 sm:border-l sm:border-zinc-700/50 sm:pl-4 sm:pl-6">
              <div className="mb-1 text-[10px] uppercase tracking-[0.28em] text-zinc-400">
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
                  <Link key={p.id} href={`/project/${p.slug || p.id}`}>
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

        {/* ── LIVE NOW Hero Section ── */}
        <LiveNowSection projects={projects} />

        <div id="section-grid">
        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-2xl border border-zinc-800/80 bg-card p-6">
                <div className="mb-4 flex items-center gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-xl bg-zinc-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-800" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
                  </div>
                </div>
                <div className="h-3 w-full animate-pulse rounded bg-zinc-800" />
                <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-zinc-800" />
                <div className="mt-5 h-1 w-full animate-pulse rounded-full bg-zinc-800" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="border border-red-500/20 bg-red-500/10 p-8 text-red-300">
            {error}
          </div>
        ) : sortedProjects.length === 0 ? (
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-800/40 p-10 text-center backdrop-blur-sm">
            {searchQuery.trim() ? (
              <div className="mx-auto max-w-md">
                <div className="mb-3 text-3xl">🔍</div>
                <p className="text-lg font-bold text-white">No businesses match &quot;{searchQuery}&quot;</p>
                <p className="mt-2 text-sm text-zinc-300">This could be yours — or help bring it to DUM Club.</p>
                <p className="mt-1 text-[10px] tracking-[0.1em] text-zinc-500">Sell anything. Buy anything. Reward everyone.</p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                  <Link href={`/?idea=${encodeURIComponent(searchQuery)}`} className="rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300">
                    Create this business →
                  </Link>
                  <button onClick={() => { setSearchQuery(""); setSearchArrival(false); }} className="rounded-xl border border-zinc-700 px-6 py-3 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white">
                    Clear search
                  </button>
                </div>
                {/* Supplier suggest */}
                <div className="mt-6 border-t border-zinc-800/50 pt-5">
                  {suggestSent ? (
                    <div className="text-center">
                      <div className="text-sm font-semibold text-emerald-400">✓ Suggestion received</div>
                      <p className="mt-1 text-[11px] text-zinc-600">You&apos;re helping grow the network. We&apos;ll reach out and invite them to join.</p>
                    </div>
                  ) : (
                    <div>
                      <p className="mb-2 text-[11px] text-zinc-500">Help bring this business to DUM Club</p>
                      <div className="flex gap-2">
                        <input
                          value={suggestName}
                          onChange={(e) => setSuggestName(e.target.value)}
                          placeholder="Business name"
                          className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600"
                        />
                        <button
                          onClick={() => submitSuggestion(suggestName || searchQuery)}
                          className="shrink-0 rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-emerald-400/30 hover:text-emerald-400"
                        >
                          Suggest
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-md">
                <div className="mb-4 text-4xl">✨</div>
                <p className="text-lg font-bold text-white">No businesses in this category yet.</p>
                <p className="mt-2 text-sm text-zinc-300">
                  Be the first merchant in this category — founding merchants get in free.
                </p>
                <Link
                  href="/merchant"
                  className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold uppercase tracking-[0.12em] text-black shadow-[0_0_24px_rgba(0,255,163,0.25)] transition hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.4)]"
                >
                  Claim Your Free Spot →
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
          {/* Featured top result — shown when arriving from search */}
          {searchArrival && searchQuery.trim() && sortedProjects.length > 0 && (() => {
            const top = sortedProjects[0];
            const topPrice = lowestOfferPrice(top);
            const topCategory = getCategory(top);
            const topOffers = offerCount(top);
            const topSold = Array.isArray(top.store_items)
              ? top.store_items.reduce((sum: number, i: any) => sum + (Number(i.quantity_sold) || 0), 0)
              : 0;

            // Build trust-based recommendation reason (no star ratings, no fabricated claims)
            let reasonText = "Best match for your search.";
            if (topSold > 0 && topOffers > 1) {
              reasonText = `Customers consistently choose this option. ${topOffers} offers with clear pricing.`;
            } else if (topSold > 0) {
              reasonText = `Real customers have purchased here. Clear pricing and strong engagement.`;
            } else if (topOffers > 1 && topPrice != null) {
              reasonText = `${topOffers} options available with transparent pricing starting at $${topPrice < 1 ? topPrice.toFixed(2) : Math.round(topPrice)}.`;
            } else if (topOffers > 0) {
              reasonText = "Active business with clear offers and pricing.";
            }

            return (
              <div className="mb-6 rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.04] to-zinc-950 p-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">Recommended</div>
                  {topSold > 0 && (
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 text-[9px] font-semibold text-emerald-400">
                      {topSold} purchased
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <Link href={`/project/${top.slug || top.id}`} className="group">
                      <h3 className="text-xl font-bold text-white transition group-hover:text-emerald-400">{top.title || top.name}</h3>
                    </Link>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{top.description || "No description."}</p>
                    <p className="mt-2 text-[11px] text-emerald-400/70">{reasonText}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-500">{topCategory}</span>
                      {topOffers > 0 && <span className="text-sky-400">{topOffers} offer{topOffers > 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
                    {topPrice != null && (
                      <div className="text-right">
                        <div className="text-[10px] text-zinc-600">From</div>
                        <div className="font-mono text-2xl font-black text-emerald-400">${topPrice < 1 ? topPrice.toFixed(2) : Math.round(topPrice)}</div>
                      </div>
                    )}
                    <Link href={`/project/${top.slug || top.id}`} className="rounded-xl bg-emerald-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_16px_rgba(0,255,163,0.15)]">
                      View Offers →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── SECTION 1: LIVE NOW ────────────────────────────
               Streaming merchants matching the current filter set.
               Collapses entirely when liveNowResults is empty. Live
               projects are NOT also rendered in Services & Businesses
               below — businessResults filters them out. */}
          {liveNowResults.length > 0 && (
            <div className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-red-400">
                  Live Now · {liveNowResults.length}
                </h2>
              </div>
              <div className="grid gap-0 border border-red-500/20 md:grid-cols-2 xl:grid-cols-3">
                {liveNowResults.map((project) => (
                  <Link
                    key={project.id}
                    href={`/project/${project.slug || project.id}?live=1`}
                    className="group border-b border-r border-red-500/10 p-6 transition hover:bg-red-500/[0.04]"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-red-400">
                        Live
                      </span>
                    </div>
                    <div className="text-base font-bold text-white transition group-hover:text-red-400">
                      {project.title || project.name || "Live business"}
                    </div>
                    {project.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{project.description}</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── SECTION 2: SERVICES & BUSINESSES ──────────────
               Non-live merchant storefronts matching the filters.
               This is the "Google Maps replacement" view. */}
          {businessResults.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-emerald-400">
                Services &amp; Businesses · {businessResults.length}
              </h2>
            </div>
          )}

          {/* Other results label (search arrival only) */}
          {searchArrival && searchQuery.trim() && sortedProjects.length > 1 && (
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
              {sortedProjects.length - 1} other result{sortedProjects.length - 1 > 1 ? "s" : ""}
            </div>
          )}
          <div className="grid gap-0 border border-zinc-900 md:grid-cols-2 xl:grid-cols-3">
            {businessResults.map((project, index) => {
              const accent = getAccent(index);
              const emoji = getProjectEmoji(project, index);
              const category = getCategory(project);
              const pulsing = pulseId === project.id;

              return (
                <Link key={project.id} href={`/project/${project.slug || project.id}${project.is_live ? "?live=1" : ""}`} className="group">
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
                        {project.is_live && (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-widest text-red-400">
                              LIVE
                            </span>
                          </>
                        )}
                        <span
                          className="rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.1em]"
                          style={{ borderColor: accent, color: accent }}
                        >
                          {category}
                        </span>
                      </div>
                    </div>

                    {/* Live video preview */}
                    {project.is_live && project.live_playback_id && project.live_provider === "native_mux" && (
                      <div className="mb-3 overflow-hidden rounded-xl border border-red-500/20">
                        <MuxPlayer
                          playbackId={project.live_playback_id}
                          streamType="live"
                          autoPlay="muted"
                          muted
                          loop
                          style={{ width: "100%", aspectRatio: "16/9", "--controls": "none" } as React.CSSProperties}
                          primaryColor="#10b981"
                          secondaryColor="#09090b"
                        />
                      </div>
                    )}

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
                      {(() => {
                        const totalSold = Array.isArray(project.store_items)
                          ? project.store_items.reduce((sum: number, i: any) => sum + (Number(i.quantity_sold) || 0), 0)
                          : 0;
                        return totalSold > 0 ? (
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-emerald-400">
                            {totalSold} purchased
                          </span>
                        ) : null;
                      })()}
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
                      {/* Star ratings hidden — trust signals come from engagement data, not ratings */}
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
                        {project.is_live ? "Tap to watch & earn →" : hasOffers(project) ? "View Offers →" : "View Project →"}
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

          {/* ── SECTION 3: ITEMS FOR SALE ─────────────────────
               Individual offers from the real `offers` table via
               /api/offers/search?q=<term>. Debounced 300ms in the
               useEffect above. Lights up Topgun's 6 aviation services
               seeded via migration 031. Collapses entirely when
               empty (no query or no matches). Price filter is
               applied client-side in the itemResults useMemo so it
               stays in sync with the Services & Businesses toolbar. */}
          {itemResults.length > 0 && (
            <div className="mt-10">
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-sky-400">
                  Items for Sale · {itemResults.length}
                </h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {itemResults.map((item, idx) => (
                  <Link
                    key={item.id || `${item.projectId}-${idx}`}
                    href={`/project/${item.projectSlug || item.projectId}#offers-section`}
                    className="group flex flex-col rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 transition hover:border-sky-400/30 hover:bg-sky-400/[0.03]"
                  >
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">
                      {item.projectName}
                    </div>
                    <div className="text-sm font-bold text-white transition group-hover:text-sky-400">
                      {item.title || "Untitled offer"}
                    </div>
                    {item.description && (
                      <p className="mt-1 line-clamp-2 text-[12px] text-zinc-500">
                        {item.description}
                      </p>
                    )}
                    <div className="mt-auto pt-4 flex items-center justify-between gap-3">
                      {item.price != null ? (
                        <span className="font-mono text-lg font-extrabold text-emerald-400">
                          ${item.price < 1 ? item.price.toFixed(2) : Math.round(item.price)}
                        </span>
                      ) : (
                        <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-600">
                          Contact for quote
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-400 transition group-hover:bg-emerald-400 group-hover:text-black">
                        Book Now →
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Supplier capture — after search results */}
          {searchArrival && searchQuery.trim() && (
            <div className="mt-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-5">
              {suggestSent ? (
                <div className="text-center">
                  <div className="text-sm font-semibold text-emerald-400">✓ Suggestion received</div>
                  <p className="mt-1 text-[11px] text-zinc-600">You&apos;re helping grow the network. We&apos;ll reach out and invite them to join.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-zinc-300">Help bring a business to DUM Club</div>
                    <div className="mt-0.5 text-[11px] text-zinc-600">We&apos;ll reach out and invite them to join the network.</div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={suggestName}
                      onChange={(e) => setSuggestName(e.target.value)}
                      placeholder="Business name"
                      className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600 sm:w-48"
                    />
                    <button
                      onClick={() => submitSuggestion(suggestName || searchQuery)}
                      className="shrink-0 rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-emerald-400/30 hover:text-emerald-400"
                    >
                      Suggest
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          </>
        )}
        </div>
      </section>
    </main>
  );
}
