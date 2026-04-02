"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Starfield } from "../components/Starfield";
import { useAuth } from "../lib/auth/AuthContext";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  template_type?: string;
  status?: string;
  created_at?: string;
  token_symbol?: string | null;
  token_utility?: string | null;
};

type RecentTrade = {
  id?: number;
  side?: string;
  price?: number;
  token_symbol?: string | null;
  created_at?: string | null;
};

type MarketSnapshot = {
  price: number;
  market_cap: number;
  volume_24h: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TEMPLATE_STARTERS = [
  { label: "Personal Trainer", prompt: "A personal training business with coaching packages and meal plans" },
  { label: "Car Wash", prompt: "A mobile car wash and detailing service with tiered packages" },
  { label: "Bakery", prompt: "A local bakery selling custom cakes, pastries, and catering" },
  { label: "Consulting", prompt: "A business consulting firm offering strategy sessions and audits" },
  { label: "Jewelry", prompt: "A handmade silver jewelry store with custom and ready-made pieces" },
  { label: "Design Studio", prompt: "A freelance design studio offering logo, brand, and web packages" },
  { label: "HVAC", prompt: "An HVAC repair and installation service with maintenance plans" },
  { label: "Digital Products", prompt: "A creator selling online courses, templates, and digital downloads" },
];

const LAUNCH_PROGRESS = [
  "Reading your idea...",
  "Building your storefront...",
  "Setting up offers...",
  "Configuring payments...",
  "Almost there...",
];

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
  return raw || "—";
}

function formatPrice(n: number) {
  if (!Number.isFinite(n) || n === 0) return "0.000000";
  return n.toFixed(6);
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatTimeAgo(iso?: string | null) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatNewsDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isPlaceholderDescription(d?: string | null) {
  if (!d?.trim()) return true;
  const s = d.trim();
  const lower = s.toLowerCase();
  if (lower.startsWith("auto-created")) return true;
  if (lower.startsWith("project workspace")) return true;
  return false;
}


/* ─── Creator Proof Data & Components ─── */
type CreatorStory = {
  id: string;
  name: string;
  emoji: string;
  tag: string;
  project: string;
  sold: string;
  result: string;
  detail: string;
  stat: { value: string; label: string };
};

const CREATOR_STORIES: CreatorStory[] = [
  {
    id: "mike",
    name: "Mike T.",
    emoji: "📄",
    tag: "Made $420 selling a resume service",
    project: "ResumeAI Pro",
    sold: "AI-powered resume reviews",
    result: "$420 revenue in first week",
    detail:
      "Mike described his resume coaching service in two sentences. The AI built his project page with booking and payment in 8 minutes. He shared the link on LinkedIn and had 14 paying clients by Friday.",
    stat: { value: "$420", label: "Week one" },
  },
  {
    id: "sarah",
    name: "Sarah K.",
    emoji: "💪",
    tag: "Launched a fitness plan in 10 minutes",
    project: "FitWithSarah",
    sold: "8-week transformation program",
    result: "22 sign-ups in 3 days",
    detail:
      "Sarah typed 'I run an 8-week body transformation program for women.' The AI created her page, pricing tiers, and booking flow. She posted the link to her Instagram story — 22 people signed up before the weekend.",
    stat: { value: "22", label: "Sign-ups" },
  },
  {
    id: "alex",
    name: "Alex R.",
    emoji: "🎨",
    tag: "Sold 12 digital products today",
    project: "DesignVault",
    sold: "Figma template packs",
    result: "12 sales in one day",
    detail:
      "Alex uploaded his Figma templates and let the AI write the product descriptions. Within 24 hours he had 12 sales — without building a website or setting up Stripe manually.",
    stat: { value: "12", label: "Sales today" },
  },
  {
    id: "priya",
    name: "Priya M.",
    emoji: "📸",
    tag: "Booked 6 clients for photo sessions",
    project: "PriyaLens",
    sold: "Portrait photography sessions",
    result: "6 bookings in 48 hours",
    detail:
      "Priya described her portrait photography packages. The AI built a clean booking page with three tiers. She shared it in two Facebook groups and booked 6 sessions in two days.",
    stat: { value: "6", label: "Bookings" },
  },
  {
    id: "dani",
    name: "Dani L.",
    emoji: "🎵",
    tag: "200 downloads of his beat pack",
    project: "DaniBeats",
    sold: "Lo-fi beat pack downloads",
    result: "200 downloads on day one",
    detail:
      "Dani dropped a link to his beat pack. The AI wrote the copy, set three pricing tiers, and the page went live. 200 downloads on the first day — no distributor, no middleman.",
    stat: { value: "200", label: "Downloads" },
  },
  {
    id: "jess",
    name: "Jess W.",
    emoji: "🧁",
    tag: "Made $310 from custom cake orders",
    project: "Jess Bakes",
    sold: "Custom cake ordering",
    result: "$310 revenue in first weekend",
    detail:
      "Jess described her custom cake business. AI built an ordering page with flavour options, delivery slots, and pricing. She shared it in her neighbourhood WhatsApp group and booked $310 in orders over the weekend.",
    stat: { value: "$310", label: "First weekend" },
  },
];

function CreatorProofModal({
  story,
  onClose,
}: {
  story: CreatorStory;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-md animate-fade-in rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-2xl shadow-black/60">
        {/* Top accent line */}
        <div className="absolute left-[20%] right-[20%] top-0 h-px bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
        >
          ✕
        </button>

        {/* Label */}
        <div className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
          <span className="inline-block h-px w-4 bg-emerald-400" />
          Creator Story
        </div>

        {/* Avatar + name */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-violet-500 text-xl">
            {story.emoji}
          </div>
          <div>
            <div className="text-[15px] font-bold text-white">{story.name}</div>
            <div className="text-[12px] text-zinc-500">{story.project}</div>
          </div>
        </div>

        {/* Quote */}
        <div className="mb-3 border-l-2 border-emerald-400/30 pl-3 text-[14px] italic leading-relaxed text-zinc-400">
          &ldquo;{story.detail}&rdquo;
        </div>

        {/* Result stat */}
        <div className="mb-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
            <div className="text-xl font-extrabold text-emerald-400">
              {story.stat.value}
            </div>
            <div className="mt-1 text-[10px] text-zinc-600">
              {story.stat.label}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
            <div className="text-xl font-extrabold text-white">AI</div>
            <div className="mt-1 text-[10px] text-zinc-600">Built by</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-center">
            <div className="text-xl font-extrabold text-white">$0</div>
            <div className="mt-1 text-[10px] text-zinc-600">Setup cost</div>
          </div>
        </div>

        {/* What they sold */}
        <div className="mb-5 rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            What they sell
          </div>
          <div className="mt-1 text-[14px] text-zinc-300">{story.sold}</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
          <span className="text-[11px] text-zinc-600">
            No developer needed
          </span>
          <Link
            href="/build"
            className="rounded-lg bg-emerald-400 px-4 py-2 text-[12px] font-bold text-black transition hover:bg-emerald-300"
          >
            Start Building →
          </Link>
        </div>
      </div>
    </div>
  );
}

function CreatorTicker({
  onPick,
}: {
  onPick: (story: CreatorStory) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const pausedRef = useRef(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let halfWidth = 0;
    const measure = () => {
      halfWidth = track.scrollWidth / 2;
    };

    // Measure after fonts/layout settle
    const measureTimer = setTimeout(measure, 100);
    window.addEventListener("resize", measure);

    let lastTime = 0;
    const speed = 60; // pixels per second

    const tick = (time: number) => {
      if (lastTime === 0) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;

      if (!pausedRef.current && halfWidth > 0) {
        offsetRef.current -= (speed * delta) / 1000;
        // Reset seamlessly when one full set has scrolled past
        if (Math.abs(offsetRef.current) >= halfWidth) {
          offsetRef.current += halfWidth;
        }
        track.style.transform = `translateX(${offsetRef.current}px)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(measureTimer);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const renderPill = (story: CreatorStory, key: string) => (
    <button
      key={key}
      onClick={() => onPick(story)}
      className="flex shrink-0 items-center gap-2.5 rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-[13px] text-zinc-400 transition hover:border-emerald-400/30 hover:bg-emerald-400/[0.04] hover:text-zinc-200 hover:shadow-[0_0_20px_rgba(0,255,163,0.08)]"
    >
      <span className="text-base">{story.emoji}</span>
      <span className="font-medium">{story.name}</span>
      <span className="text-zinc-600">·</span>
      <span className="text-emerald-400/80">{story.tag}</span>
    </button>
  );

  return (
    <div
      className="overflow-hidden"
      style={{ maskImage: "linear-gradient(to right, transparent, black 4%, black 96%, transparent)" }}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      <div
        ref={trackRef}
        className="flex gap-4"
        style={{ width: "max-content", willChange: "transform" }}
      >
        {CREATOR_STORIES.map((s, i) => renderPill(s, `a-${s.id}-${i}`))}
        {CREATOR_STORIES.map((s, i) => renderPill(s, `b-${s.id}-${i}`))}
      </div>
    </div>
  );
}

/* ─── Activity Ticker (rAF-driven for cross-browser reliability) ─── */
function ActivityTicker({ trades }: { trades: RecentTrade[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    let halfWidth = 0;
    const measure = () => { halfWidth = track.scrollWidth / 2; };
    const timer = setTimeout(measure, 100);
    window.addEventListener("resize", measure);

    let lastTime = 0;
    const speed = 50;

    const tick = (time: number) => {
      if (lastTime === 0) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;
      if (halfWidth > 0) {
        offsetRef.current -= (speed * delta) / 1000;
        if (Math.abs(offsetRef.current) >= halfWidth) offsetRef.current += halfWidth;
        track.style.transform = `translateX(${offsetRef.current}px)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [trades]);

  const items = [...trades, ...trades, ...trades, ...trades];

  return (
    <div className="overflow-hidden py-3">
      <div ref={trackRef} className="flex gap-8" style={{ width: "max-content", willChange: "transform" }}>
        {items.map((trade, i) => {
          const side = trade.side === "sell" ? "sell" : "buy";
          const price = Number(trade.price ?? 0);
          const sym = trade.token_symbol || "—";
          return (
            <span key={`t-${i}`} className="flex shrink-0 items-center font-mono text-xs text-zinc-500">
              <span className={side === "buy" ? "text-emerald-400" : "text-red-400"}>
                {side === "buy" ? "↑" : "↓"}
              </span>{" "}
              {sym} · ${formatPrice(price)} · {formatTimeAgo(trade.created_at)}
              <span className="mx-4 text-zinc-800">|</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Homepage Section Nav ─── */
const HOME_SECTIONS = [
  { id: "section-hero", label: "Top" },
  { id: "section-how", label: "How It Works" },
  { id: "section-features", label: "Features" },
  { id: "section-projects", label: "Projects" },
  { id: "section-stats", label: "Stats" },
  { id: "section-cta", label: "Get Started" },
];

function HomeSectionNav() {
  const [active, setActive] = useState("");

  useEffect(() => {
    const ids = HOME_SECTIONS.filter((s) => document.getElementById(s.id)).map((s) => s.id);
    if (ids.length < 2) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 }
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
        {HOME_SECTIONS.map((s) => {
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

export default function Home() {
  const router = useRouter();
  const { user, login } = useAuth();
  const { wallets, createWallet } = useSolanaWallets();
  const walletAddress = user?.walletAddress ?? wallets[0]?.address ?? null;

  // ── Launch state ──
  const [heroIdea, setHeroIdea] = useState("");
  const [heroLaunching, setHeroLaunching] = useState(false);
  const [heroError, setHeroError] = useState("");
  const [heroProgress, setHeroProgress] = useState(0);
  const [pendingAutoLaunch, setPendingAutoLaunch] = useState(false);

  // ── Existing state ──
  const [creatorModal, setCreatorModal] = useState<CreatorStory | null>(null);
  const [allPublicProjects, setAllPublicProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const marketPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Progress step animation ──
  useEffect(() => {
    if (!heroLaunching) { setHeroProgress(0); return; }
    const timers = LAUNCH_PROGRESS.map((_, i) =>
      window.setTimeout(() => setHeroProgress(i), i * 5000)
    );
    return () => timers.forEach(clearTimeout);
  }, [heroLaunching]);

  // ── Check localStorage for pending idea on mount ──
  useEffect(() => {
    const pending = localStorage.getItem("pendingIdea");
    if (pending) setHeroIdea(pending);
  }, []);

  // ── Auto-launch: when user + wallet + pendingIdea are all ready ──
  useEffect(() => {
    if (!pendingAutoLaunch) return;
    if (heroLaunching) return; // prevent double-launch
    if (!user || !walletAddress) return;
    const idea = localStorage.getItem("pendingIdea");
    if (!idea?.trim()) { setPendingAutoLaunch(false); return; }
    // All conditions met — auto-launch
    setPendingAutoLaunch(false);
    doHeroLaunch(idea.trim());
  }, [pendingAutoLaunch, user, walletAddress, heroLaunching]);

  // ── Auto-create wallet if user is authenticated but has no wallet ──
  useEffect(() => {
    if (user && !walletAddress && pendingAutoLaunch) {
      createWallet().catch(() => {});
    }
  }, [user, walletAddress, pendingAutoLaunch]);

  // ── Core launch function ──
  async function doHeroLaunch(idea: string) {
    if (heroLaunching) return; // guard against double-call
    if (!walletAddress) {
      setHeroError("Wallet not ready yet. Please try again in a moment.");
      return;
    }
    setHeroLaunching(true);
    setHeroError("");
    try {
      const res = await fetch(`${API_BASE}/api/launch/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          owner_id: user?.privyId ?? null,
          wallet_address: walletAddress,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setHeroLaunching(false);
          setHeroError("Daily launch limit reached. Try again tomorrow or upgrade.");
          return;
        }
        throw new Error(data?.detail || "Launch failed — please try again.");
      }
      const data = await res.json();
      localStorage.removeItem("pendingIdea");
      router.push(`/project/${data.project_id}?launched=1`);
    } catch (err) {
      setHeroLaunching(false);
      setHeroError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // ── Handle Launch button click ──
  function handleHeroLaunch() {
    if (!heroIdea.trim() || heroLaunching) return;
    if (!user) {
      // Save idea, trigger login, set pending flag
      localStorage.setItem("pendingIdea", heroIdea.trim());
      setPendingAutoLaunch(true);
      login();
      return;
    }
    if (!walletAddress) {
      // Save idea, create wallet, set pending flag
      localStorage.setItem("pendingIdea", heroIdea.trim());
      setPendingAutoLaunch(true);
      createWallet().catch(() => {});
      return;
    }
    // Ready — launch immediately
    doHeroLaunch(heroIdea.trim());
  }

  const latestProjectsNews = useMemo(
    () =>
      allPublicProjects
        .filter((p) => !isPlaceholderDescription(p.description))
        .slice(0, 3),
    [allPublicProjects]
  );

  const tradesInLast24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return recentTrades.filter((t) => {
      if (!t.created_at) return false;
      const ts = new Date(t.created_at).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
  }, [recentTrades]);

  const liveProjectCount = useMemo(() => {
    const n = allPublicProjects.filter((p) => p.status === "live").length;
    return n > 0 ? n : allPublicProjects.length;
  }, [allPublicProjects]);

  const featured = useMemo(() => {
    if (!allPublicProjects.length) return null;
    let best: Project | null = null;
    let bestVol = -1;
    for (const p of allPublicProjects) {
      const m = marketByProject[p.id];
      const vol = Number(m?.volume_24h ?? 0);
      if (vol > bestVol) {
        bestVol = vol;
        best = p;
      }
    }
    if (best && bestVol > 0) {
      return { project: best, market: marketByProject[best.id] };
    }
    const first = allPublicProjects[0];
    return { project: first, market: marketByProject[first.id] };
  }, [allPublicProjects, marketByProject]);

  async function loadPublicProjects() {
    try {
      setLoadingProjects(true);
      const res = await fetch(`${API_BASE}/api/projects/public`);
      if (!res.ok) throw new Error("Failed to load public projects");

      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.projects || [];
      setAllPublicProjects(list);
    } catch (err) {
      console.error(err);
      setAllPublicProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }

  async function loadRecentTrades() {
    try {
      const res = await fetch(`${API_BASE}/api/activity/recent-trades`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("recent trades");
      const data = await res.json();
      setRecentTrades(Array.isArray(data?.trades) ? data.trades : []);
    } catch (err) {
      console.error(err);
      setRecentTrades([]);
    }
  }

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

      setMarketByProject(() => {
        const next: Record<string, MarketSnapshot> = {};
        for (const [projectId, snapshot] of snapshots) {
          if (!snapshot) continue;
          next[projectId] = snapshot;
        }
        return next;
      });
    } catch (err) {
      console.error("HOME MARKET LOAD ERROR:", err);
    }
  }

  useEffect(() => {
    loadPublicProjects();
    loadRecentTrades();
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadRecentTrades();
    }, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const projectIds = allPublicProjects.map((p) => p.id).filter(Boolean);
    if (!projectIds.length) return;

    loadMarketSnapshots(projectIds);

    if (marketPollRef.current) clearInterval(marketPollRef.current);
    marketPollRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadMarketSnapshots(projectIds);
    }, 15000);

    return () => {
      if (marketPollRef.current) clearInterval(marketPollRef.current);
    };
  }, [allPublicProjects]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-base text-white">
      <Starfield count={130} />
      <HomeSectionNav />
      <section className="relative z-[1] mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        {/* ── HERO — Input-First ── */}
        <div id="section-hero" className="relative rounded-2xl border border-zinc-800/60 bg-base/80 backdrop-blur-sm">
          {/* Ambient background */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="h-full w-full bg-[radial-gradient(ellipse_at_top_center,rgba(0,255,163,0.12),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(123,97,255,0.08),transparent_50%)]" />
            <div
              className="absolute pointer-events-none"
              style={{ left: "-8%", top: "5%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,255,163,0.07), transparent 65%)", filter: "blur(80px)", animation: "orb-drift 22s ease-in-out infinite" }}
            />
            <div
              className="absolute pointer-events-none"
              style={{ right: "-5%", bottom: "0%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(123,97,255,0.09), transparent 65%)", filter: "blur(80px)", animation: "orb-drift-reverse 28s ease-in-out infinite" }}
            />
          </div>

          <div className="relative px-6 py-14 sm:px-10 sm:py-20 lg:px-16 lg:py-24">
            <div className="mx-auto max-w-3xl text-center">

              <h1 className="hero-entrance text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
                Describe your idea.
                <br />
                <span className="text-emerald-400" style={{ textShadow: "0 0 40px rgba(0,255,163,0.3)" }}>
                  AI builds your business.
                </span>
              </h1>

              <p className="hero-entrance-delay-1 mx-auto mt-5 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
                Type what you want to offer. AI creates your storefront, offers, and payments — you go live instantly.
              </p>

              {/* ── LAUNCH INPUT ── */}
              <div className="hero-entrance-delay-2 mx-auto mt-10 max-w-2xl">
                <textarea
                  value={heroIdea}
                  onChange={(e) => setHeroIdea(e.target.value)}
                  placeholder="Describe your business idea..."
                  rows={3}
                  disabled={heroLaunching}
                  className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4 text-base leading-relaxed text-white placeholder-zinc-600 outline-none transition focus:border-emerald-400/60 disabled:opacity-50"
                />

                <button
                  type="button"
                  onClick={handleHeroLaunch}
                  disabled={!heroIdea.trim() || heroLaunching}
                  className="mt-3 w-full rounded-2xl bg-emerald-400 px-8 py-4 text-sm font-bold uppercase tracking-[0.15em] text-black transition-all duration-300 hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.35)] hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {heroLaunching ? (
                    <span className="flex items-center justify-center gap-3">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      <span key={heroProgress} className="animate-fade-in">
                        {LAUNCH_PROGRESS[heroProgress]}
                      </span>
                    </span>
                  ) : (
                    "Launch →"
                  )}
                </button>

                {heroError && (
                  <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {heroError}
                  </div>
                )}

                {heroLaunching && (
                  <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
                    Step {heroProgress + 1} of {LAUNCH_PROGRESS.length} · usually under 30s
                  </p>
                )}
              </div>

              {/* ── TEMPLATE STARTERS ── */}
              {!heroLaunching && (
                <div className="hero-entrance-delay-2 mx-auto mt-6 max-w-2xl">
                  <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                    Start from an example
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {TEMPLATE_STARTERS.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => setHeroIdea(t.prompt)}
                        className="rounded-full border border-zinc-800 bg-zinc-950/60 px-3.5 py-1.5 text-[12px] text-zinc-500 transition hover:border-emerald-400/30 hover:text-zinc-300"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Trust line ── */}
              <p className="hero-entrance-delay-2 mx-auto mt-6 text-[13px] text-zinc-600">
                {allPublicProjects.length > 0 && (
                  <span className="text-emerald-400/70">{allPublicProjects.length} projects live</span>
                )}
                {allPublicProjects.length > 0 && " · "}
                No website needed · No developer required ·{" "}
                <Link href={allPublicProjects.length > 0 ? `/project/${allPublicProjects[0].id}` : "/discover"} className="text-zinc-500 underline decoration-zinc-700 transition hover:text-zinc-300">
                  See live example
                </Link>
              </p>

            </div>
          </div>
        </div>

        {/* ── CREATOR PROOF ── */}
        {creatorModal && (
          <CreatorProofModal
            story={creatorModal}
            onClose={() => setCreatorModal(null)}
          />
        )}
        <div className="creator-section-fade mx-auto mt-14 max-w-6xl">
          <div className="mb-3 text-center text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
            Creators building right now
          </div>
          <CreatorTicker onPick={setCreatorModal} />
        </div>

        <div
          id="section-how"
          className="scroll-mt-28 mx-auto mt-20 max-w-6xl border border-zinc-900 bg-zinc-950/40 px-8 py-16 sm:px-12 sm:py-20"
        >
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-emerald-400">
            How it works
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Three steps. Your business, live today.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            No developers. No technical knowledge. Just describe what you offer.
          </p>
          <div className="mt-12 grid gap-3 pt-10 sm:grid-cols-3">
            {[
              { n: "01", title: "Describe It", desc: "Tell the AI what you offer in plain English — coaching, services, products, anything." },
              { n: "02", title: "We Launch It", desc: "Your storefront, pricing, and offers go live automatically. No setup needed." },
              { n: "03", title: "Your Fans Buy It", desc: "Customers pay by card. Loyalty perks unlock automatically for your best supporters." },
            ].map((step) => (
              <div
                key={step.n}
                className="card-premium group relative overflow-hidden rounded-xl border border-zinc-800/40 bg-gradient-to-br from-zinc-900/60 to-zinc-950 p-6 hover:border-emerald-400/15"
              >
                <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-emerald-400/[0.03] blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                <div className="font-mono text-3xl font-extrabold text-emerald-400/30">{step.n}</div>
                <div className="mt-3 text-base font-bold text-white">{step.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── FEATURES ── */}
        <div id="section-features" className="mx-auto mt-20 max-w-6xl px-2">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.35em] text-emerald-400">
            Platform
          </div>
          <h2 className="mb-10 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Everything you need. Nothing you don&apos;t.
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                tag: "AI",
                title: "AI Project Builder",
                desc: "Describe your idea. The AI builds your storefront, pricing, and offers instantly.",
              },
              {
                tag: "Store",
                title: "Creator Marketplace",
                desc: "Sell services, products, or access. One link. Customers pay instantly.",
              },
              {
                tag: "Loyalty",
                title: "Automatic Rewards",
                desc: "Your best customers unlock perks automatically. No extra work.",
              },
              {
                tag: "Payments",
                title: "Fast Invisible Payments",
                desc: "Payments are instant and simple. No technical knowledge required.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="card-premium group relative overflow-hidden rounded-xl border border-zinc-800/40 bg-gradient-to-br from-zinc-900/60 to-zinc-950 p-7 hover:border-emerald-400/15"
              >
                <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full bg-emerald-400/[0.03] blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                <div className="mb-3 inline-block rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  {f.tag}
                </div>
                <h3 className="mb-2 text-lg font-bold text-white">{f.title}</h3>
                <p className="text-sm leading-relaxed text-zinc-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Live activity ticker */}
        <div className="mx-auto mt-20 max-w-7xl border-t border-zinc-900">
          <div className="border-b border-zinc-900/80 py-2 text-center">
            <span className="font-mono text-[10px] text-zinc-600">
              {tradesInLast24h} trades in the last 24h across {liveProjectCount}{" "}
              live project{liveProjectCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mb-2 px-4 pt-3 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-600">
            Live activity
          </div>
          {recentTrades.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-600">
              No activity yet — launch a project and make the first move.
            </div>
          ) : (
            <ActivityTicker trades={recentTrades} />
          )}
        </div>

        {/* Featured project spotlight */}
        <div id="section-projects" className="border-t border-zinc-900 px-4 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
              Featured project
            </div>
            {featured?.project && (
              <Link href={`/project/${featured.project.id}`}>
                <div
                  className="card-premium group relative overflow-hidden rounded-3xl border border-zinc-800/60 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900/50 p-8 hover:border-emerald-400/25"
                  style={{ borderTop: "2px solid rgba(0,255,163,0.3)" }}
                >
                  {/* Inner ambient glow */}
                  <div className="pointer-events-none absolute -right-20 -top-20 h-40 w-40 rounded-full bg-emerald-400/[0.04] blur-3xl transition-opacity duration-500 group-hover:opacity-100 opacity-0" />
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-5">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-zinc-800/50 bg-gradient-to-br from-zinc-900 to-zinc-950 text-3xl shadow-inner">
                        {getProjectEmoji(featured.project, 0)}
                      </div>
                      <div>
                        <div className="text-2xl font-black text-white">
                          {featured.project.title || featured.project.name || "Untitled"}
                        </div>
                        <div className="mt-1 max-w-lg text-sm leading-relaxed text-zinc-300">
                          {featured.project.description || "No description yet."}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] text-emerald-400">
                            ${getTicker(featured.project)}
                          </span>
                          <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-500">
                            {featured.project.token_utility || "AI-powered access"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {featured.market ? (
                        <>
                          <div className="font-mono text-3xl font-black text-white">
                            ${formatPrice(featured.market.price)}
                          </div>
                          <div className="mt-1 font-mono text-sm text-emerald-400">
                            ${formatNumber(featured.market.market_cap, 0)} mkt cap
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-zinc-500">Market loading…</div>
                      )}
                      <div className="mt-4 inline-block rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black transition group-hover:bg-emerald-400">
                        View project →
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            )}
            {!featured?.project && !loadingProjects && (
              <p className="text-sm text-zinc-500">No public projects yet.</p>
            )}
          </div>
        </div>

        {/* Platform stats */}
        <div id="section-stats" className="border-t border-zinc-900 bg-zinc-950/30 px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 text-center text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
              Platform
            </div>
            <div className="grid grid-cols-2 gap-10 lg:grid-cols-4">
              {[
                {
                  label: "Projects live",
                  value: allPublicProjects.length.toString(),
                },
                { label: "AI questions answered", value: "∞" },
                { label: "Categories", value: "5+" },
                { label: "Built on Solana", value: "✓" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-zinc-800/30 bg-gradient-to-b from-zinc-900/40 to-transparent p-6 text-center"
                >
                  <div className="font-mono text-4xl font-black text-white sm:text-5xl">
                    {stat.value}
                  </div>
                  <div className="mt-3 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div id="section-cta" className="border-t border-zinc-900 px-4 py-20 text-center sm:py-28">
          <div className="mx-auto max-w-2xl">
            <div className="mb-5 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
              Ready?
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Your business.
              <br />
              <span className="text-emerald-400">Live today.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-zinc-300">
              Tell the AI what you offer. We handle the storefront, payments, and loyalty — you just share the link.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/build"
                className="rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_24px_rgba(0,255,163,0.25)]"
              >
                Start Building Free →
              </Link>
              <Link
                href="/discover"
                className="rounded-xl border border-zinc-700 px-8 py-4 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Browse Creator Stores
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Latest — real public projects */}
      <div className="border-t border-zinc-900 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
            Recently Launched
          </div>
          {latestProjectsNews.length === 0 && !loadingProjects ? (
            <p className="text-sm text-zinc-500">
              {allPublicProjects.length === 0
                ? "No projects yet — be the first to launch."
                : "New projects will appear here as they launch."}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {loadingProjects && latestProjectsNews.length === 0
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-32 animate-pulse rounded-xl border border-zinc-800/50 bg-gradient-to-br from-zinc-950 to-zinc-900/30"
                    />
                  ))
                : latestProjectsNews.map((p) => (
                    <Link
                      key={p.id}
                      href={`/project/${p.id}`}
                      className="card-premium block rounded-xl border border-zinc-800/50 bg-gradient-to-br from-zinc-950 to-zinc-900/30 p-6 hover:border-emerald-400/15"
                    >
                      <div className="mb-2 font-mono text-[10px] text-emerald-500">
                        {formatNewsDate(p.created_at)}
                      </div>
                      <div className="mb-2 text-base font-bold leading-tight text-white">
                        {p.title || p.name || "Untitled project"}
                      </div>
                      <div className="line-clamp-3 text-sm leading-relaxed text-zinc-400">
                        {p.description?.trim() || "Live on DUM Club with AI and community features."}
                      </div>
                    </Link>
                  ))}
            </div>
          )}
        </div>
      </div>

      {/* Honest stack strip (no fake press logos) */}
      <div className="border-t border-zinc-900 py-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-5 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
            Built with
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-3">
            {["Solana", "Supabase", "Next.js"].map((name) => (
              <span
                key={name}
                className="text-sm font-bold tracking-wide text-zinc-400"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <footer className="border-t border-zinc-900 bg-base px-4 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="grid gap-12 lg:grid-cols-[2fr_1fr_1fr_1fr]">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xl font-black tracking-tight text-white">
                  DUM<span className="text-emerald-400">CLUB</span>
                </span>
                <span className="rounded border border-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-600">
                  BETA
                </span>
              </div>
              <p className="mb-4 text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                DIGITAL UTILITY MOVEMENT
              </p>
              <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
                Build AI-powered projects on Solana. Supporters back ideas early. Communities grow with demand.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                  <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="font-mono text-[10px] text-emerald-500">
                  LIVE ON SOLANA
                </span>
              </div>
            </div>

            <div>
              <div className="mb-4 text-[9px] uppercase tracking-[0.25em] text-zinc-600">
                Platform
              </div>
              <ul className="space-y-3">
                {[
                  { label: "Discover", href: "/discover" },
                  { label: "Build a project", href: "/build" },
                  { label: "Dashboard", href: "/dashboard" },
                  { label: "AI Chat", href: "/chat" },
                ].map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-zinc-500 transition hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-4 text-[9px] uppercase tracking-[0.25em] text-zinc-600">
                Community
              </div>
              <ul className="space-y-3">
                {[
                  { label: "Twitter / X", href: "https://x.com" },
                  { label: "Discord", href: "#" },
                  { label: "Telegram", href: "#" },
                  {
                    label: "Instagram @julez_future",
                    href: "https://instagram.com/julez_future",
                  },
                ].map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-500 transition hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="mb-4 text-[9px] uppercase tracking-[0.25em] text-zinc-600">
                Resources
              </div>
              <ul className="space-y-3">
                {[
                  { label: "How it works", href: "/#section-how" },
                  { label: "How rewards work", href: "#" },
                  { label: "Creator guide", href: "#" },
                  {
                    label: "Contact",
                    href: "mailto:julian@topgunmaintenance.com",
                  },
                ].map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-zinc-500 transition hover:text-white"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-16 border-t border-zinc-900 pt-8">
            <p className="mb-4 text-[11px] leading-relaxed text-zinc-700">
              The content on this platform is for informational purposes only and does not
              constitute financial, legal, or investment advice. Token prices are determined by
              market activity and may be volatile. You assume sole responsibility for evaluating any
              risks associated with participating in DUM Club projects or purchasing tokens. DUM Club
              is built on Solana and operates in an experimental capacity as a beta product.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-[10px] text-zinc-700">
                © {new Date().getFullYear()} DUM Club. All rights reserved.
              </div>
              <div className="flex gap-6">
                {["Terms of Use", "Privacy Policy", "Token Disclaimer"].map((item) => (
                  <a
                    key={item}
                    href="#"
                    className="text-[10px] text-zinc-700 transition hover:text-zinc-400"
                  >
                    {item}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
