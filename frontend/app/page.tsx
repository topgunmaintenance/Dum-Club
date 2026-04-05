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
  { label: "Sell coaching", prompt: "A personal training service selling custom workout plans and meal prep packages" },
  { label: "Sell services", prompt: "A mobile car wash and detailing service with tiered packages" },
  { label: "Sell products", prompt: "A local bakery selling custom cakes, pastries, and catering" },
  { label: "Sell consulting", prompt: "A business consulting firm offering strategy sessions and audits" },
  { label: "Sell handmade", prompt: "A handmade silver jewelry store with custom and ready-made pieces" },
  { label: "Sell design", prompt: "A freelance design studio offering logo, brand, and web packages" },
  { label: "Sell maintenance", prompt: "An HVAC repair and installation service with maintenance plans" },
  { label: "Sell digital goods", prompt: "A creator selling online courses, templates, and digital downloads" },
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
          Example Scenario
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
            Start Selling →
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
function DumActivityStrip({ projectCount, tradeCount }: { projectCount: number; tradeCount: number }) {
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
    const speed = 40;

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
  }, [projectCount, tradeCount]);

  const item = (key: string) => (
    <span key={key} className="flex shrink-0 items-center gap-3 font-mono text-xs text-zinc-500">
      <span className="text-emerald-400">↑</span>
      <span className="font-bold text-emerald-400/80">DUM</span>
      <span className="text-zinc-700">·</span>
      <span>Activity rising</span>
      <span className="text-zinc-700">·</span>
      {projectCount > 0 ? (
        <span><span className="text-zinc-400">{projectCount}</span> businesses live</span>
      ) : (
        <span>Businesses launching now</span>
      )}
      <span className="text-zinc-700">·</span>
      {tradeCount > 0 ? (
        <span><span className="text-zinc-400">{tradeCount}</span> sales on DUM Club</span>
      ) : (
        <span>Sales happening on DUM Club</span>
      )}
      <span className="mx-6 text-zinc-800">|</span>
    </span>
  );

  return (
    <div className="overflow-hidden py-3">
      <div ref={trackRef} className="flex" style={{ width: "max-content", willChange: "transform" }}>
        {Array.from({ length: 6 }).map((_, i) => item(`strip-${i}`))}
      </div>
    </div>
  );
}

/* ─── Recent Sales Proof Feed ─── */
function RecentSalesFeed() {
  const [sales, setSales] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);

  useEffect(() => {
    fetch(`${API_BASE}/api/checkout/recent-sales`)
      .then((r) => r.json())
      .then((d) => setSales(d.sales || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (sales.length === 0) return;
    const t = setInterval(() => setCurrentIdx((i) => (i + 1) % sales.length), 4000);
    return () => clearInterval(t);
  }, [sales.length]);

  if (sales.length === 0) return null;

  return (
    <div className="mx-auto mt-10 max-w-4xl">
      <div className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
        Recent sales on DUM Club
      </div>
      <div className="space-y-2">
        {sales.slice(0, 5).map((sale, i) => {
          const isActive = i === currentIdx % Math.min(sales.length, 5);
          const ago = sale.created_at ? formatSaleTimeAgo(sale.created_at) : "";
          return (
            <div
              key={sale.id}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-500 ${
                isActive
                  ? "border-emerald-400/20 bg-emerald-400/[0.04] shadow-[0_0_12px_rgba(0,255,163,0.04)]"
                  : "border-zinc-800/40 bg-zinc-950/40"
              }`}
            >
              <div className="flex items-center gap-3">
                {isActive && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                )}
                <div>
                  <span className="text-[13px] font-semibold text-white">{sale.business_name || "Business"}</span>
                  <span className="mx-2 text-zinc-700">·</span>
                  <span className="text-[12px] text-zinc-400">{sale.offer_title}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] font-bold text-emerald-400">+${sale.amount?.toFixed(2)}</span>
                <span className="text-[10px] text-zinc-600">{ago}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatSaleTimeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ─── Platform Activity Feed ─── */
const ACTIVITY_MESSAGES = [
  { icon: "🟢", text: "New business storefront went live" },
  { icon: "💳", text: "Offer purchased via Stripe checkout" },
  { icon: "⚡", text: "AI built a storefront in under 60s" },
  { icon: "✓", text: "Business verified by review team" },
  { icon: "🔁", text: "Returning customer used DUM Points" },
  { icon: "📦", text: "New service offer published" },
  { icon: "🟢", text: "Storefront launched with 3 offers" },
  { icon: "💳", text: "Subscription offer purchased" },
  { icon: "⚡", text: "Business created from single sentence" },
  { icon: "✓", text: "Offer fulfilled — seller paid out" },
];

function PlatformActivity({ projectCount }: { projectCount: number }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % ACTIVITY_MESSAGES.length), 3000);
    return () => clearInterval(t);
  }, []);

  const msg = ACTIVITY_MESSAGES[idx];

  return (
    <div className="flex items-center justify-center gap-3 rounded-full border border-zinc-800/40 bg-zinc-950/60 px-5 py-2.5 backdrop-blur-sm">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
      </span>
      <span key={idx} className="animate-fade-in text-[12px] text-zinc-400">
        <span className="mr-1.5">{msg.icon}</span>
        {msg.text}
      </span>
      {projectCount > 0 && (
        <span className="ml-2 text-[10px] text-zinc-600">
          · {projectCount} live
        </span>
      )}
    </div>
  );
}

/* ─── Live Preview Generator (frontend-only, no API) ─── */
function generatePreview(idea: string): { name: string; offers: { title: string; price: string }[]; desc: string; emoji: string; tag: string } | null {
  const t = idea.trim().toLowerCase();
  if (t.length < 10) return null;

  // Extract keywords to generate a plausible name
  const words = idea.trim().split(/\s+/).filter((w) => w.length > 2);
  const keyWords = words
    .filter((w) => !["the", "and", "for", "with", "that", "this", "from", "into", "about", "have", "will", "can", "are", "was", "been"].includes(w.toLowerCase()))
    .slice(0, 3);
  const name = keyWords.length >= 2
    ? keyWords.slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ")
    : keyWords.length === 1
    ? keyWords[0].charAt(0).toUpperCase() + keyWords[0].slice(1).toLowerCase() + " Pro"
    : "Your Business";

  // Detect category
  const isGaming = t.includes("game") || t.includes("play") || t.includes("arcade") || t.includes("tetris") || t.includes("snake") || t.includes("puzzle") || t.includes("rpg") || t.includes("shooter") || t.includes("racing") || t.includes("chess") || t.includes("pong") || t.includes("quiz") || t.includes("simulator") || t.includes("tycoon") || t.includes("strategy") || t.includes("platformer") || t.includes("battle") || t.includes("horror") || t.includes("idle") || t.includes("clicker") || t.includes("multiplayer");
  const isSaas = t.includes("app") || t.includes("tool") || t.includes("platform") || t.includes("dashboard") || t.includes("tracker") || t.includes("manager") || t.includes("calculator") || t.includes("scheduler");
  const isCreator = t.includes("art") || t.includes("music") || t.includes("beat") || t.includes("photo") || t.includes("video") || t.includes("course") || t.includes("ebook") || t.includes("podcast") || t.includes("design");
  const isService = t.includes("service") || t.includes("coaching") || t.includes("consulting") || t.includes("training") || t.includes("repair") || t.includes("clean") || t.includes("wash");
  const isFood = t.includes("food") || t.includes("bake") || t.includes("cake") || t.includes("cook") || t.includes("restaurant") || t.includes("catering");

  let offers: { title: string; price: string }[];
  let emoji: string;
  let tag: string;

  if (isGaming) {
    emoji = "🎮";
    tag = "Entertainment Business";
    offers = [
      { title: "Early Access Pass", price: "$9.99" },
      { title: "Founder Pack", price: "$29.99" },
      { title: "Community Membership", price: "$4.99/mo" },
    ];
  } else if (isSaas) {
    emoji = "💻";
    tag = "Digital Product";
    offers = [
      { title: "Starter Plan", price: "$9/mo" },
      { title: "Pro Plan", price: "$29/mo" },
      { title: "Enterprise Access", price: "$99/mo" },
    ];
  } else if (isCreator) {
    emoji = "🎨";
    tag = "Creator Business";
    offers = [
      { title: "Single Download", price: "$5" },
      { title: "Complete Bundle", price: "$29" },
      { title: "Monthly Membership", price: "$9/mo" },
    ];
  } else if (isService) {
    emoji = "⚡";
    tag = "Service Business";
    offers = [
      { title: "Basic Session", price: "$29" },
      { title: "Full Package", price: "$89" },
      { title: "Monthly Plan", price: "$49/mo" },
    ];
  } else if (isFood) {
    emoji = "🍽️";
    tag = "Food Business";
    offers = [
      { title: "Single Order", price: "$15" },
      { title: "Party Package", price: "$75" },
      { title: "Weekly Plan", price: "$45/wk" },
    ];
  } else {
    emoji = "✨";
    tag = "Storefront";
    offers = [
      { title: "Basic", price: "$29" },
      { title: "Professional", price: "$79" },
      { title: "Unlimited", price: "$49/mo" },
    ];
  }

  const desc = idea.trim().length > 60 ? idea.trim().slice(0, 57) + "..." : idea.trim();

  return { name, offers, desc, emoji, tag };
}

/* ─── DUM Points Helpers ─── */
function getDumPoints(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem("dum_points") || "50");
}

function awardDumPoints(amount: number): number {
  const current = getDumPoints();
  const next = current + amount;
  localStorage.setItem("dum_points", String(next));
  // Notify other components (Navbar, Dashboard)
  window.dispatchEvent(new Event("dum-points-update"));
  return next;
}

/* ─── Free Launch Limit ─── */
const FREE_LAUNCH_LIMIT = 3;
const LAUNCH_COUNT_KEY = "dumclub_launch_count";

function getLaunchCount(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(LAUNCH_COUNT_KEY) || "0");
}

function incrementLaunchCount(): number {
  const next = getLaunchCount() + 1;
  localStorage.setItem(LAUNCH_COUNT_KEY, String(next));
  return next;
}

/* ─── Animated Product Demo ─── */
const DEMO_IDEA = "Mobile car wash for busy professionals with premium detailing packages";

function ProductDemo() {
  const [phase, setPhase] = useState(0); // 0=typing, 1=building, 2=live, 3=purchase
  const [typedLen, setTypedLen] = useState(0);
  const [buildStep, setBuildStep] = useState(0);
  const [liveStep, setLiveStep] = useState(0);
  const [loopKey, setLoopKey] = useState(0);

  // Phase durations and auto-loop (clean restart via loopKey)
  useEffect(() => {
    const schedule = [
      { at: 0, fn: () => { setPhase(0); setTypedLen(0); setBuildStep(0); setLiveStep(0); } },
      { at: 3800, fn: () => setPhase(1) },
      { at: 4200, fn: () => setBuildStep(1) },
      { at: 4800, fn: () => setBuildStep(2) },
      { at: 5400, fn: () => setBuildStep(3) },
      { at: 6000, fn: () => setBuildStep(4) },
      { at: 6600, fn: () => setBuildStep(5) },
      { at: 7200, fn: () => setBuildStep(6) },
      { at: 7800, fn: () => setPhase(2) },
      { at: 8200, fn: () => setLiveStep(1) },
      { at: 8800, fn: () => setLiveStep(2) },
      { at: 9400, fn: () => setLiveStep(3) },
      { at: 10000, fn: () => setLiveStep(4) },
      // Purchase simulation
      { at: 11500, fn: () => setPhase(3) },
      // Clean restart
      { at: 14500, fn: () => setLoopKey((k) => k + 1) },
    ];
    const timers = schedule.map((s) => setTimeout(s.fn, s.at));
    return () => timers.forEach(clearTimeout);
  }, [loopKey]);

  // Typing animation
  useEffect(() => {
    if (phase !== 0) return;
    const t = setInterval(() => {
      setTypedLen((l) => {
        if (l >= DEMO_IDEA.length) { clearInterval(t); return l; }
        return l + 1;
      });
    }, 35);
    return () => clearInterval(t);
  }, [phase]);

  // Progress indicator
  const progressPct = phase === 0 ? 0 : phase === 1 ? 50 : 100;

  return (
    <div className="mt-16">
      <div className="mb-6 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-600">
        Watch it happen — idea to revenue
      </div>

      {/* Progress dots */}
      <div className="mx-auto mb-6 flex max-w-xs items-center gap-2 justify-center">
        {["Describe", "Build", "Live", "Revenue"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-500 ${
              phase >= i ? "bg-emerald-400 text-black shadow-[0_0_10px_rgba(0,255,163,0.3)]" : "border border-zinc-800 text-zinc-700"
            }`}>
              {phase > i ? "✓" : i + 1}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-widest transition-colors duration-300 ${
              phase >= i ? "text-emerald-400" : "text-zinc-700"
            }`}>{label}</span>
            {i < 3 && <span className={`text-sm transition-colors duration-300 ${phase > i ? "text-emerald-400/40" : "text-zinc-800"}`}>→</span>}
          </div>
        ))}
      </div>

      {/* DUM CLUB AI Window — same chrome as the product */}
      <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-800/60 bg-zinc-950/90 shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(0,255,163,0.04)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          <div className="flex-1 text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            DUM CLUB AI
          </div>
          <div className="relative flex h-2 w-2">
            <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </div>
        </div>

        {/* Content area */}
        <div className="px-5 py-5 sm:px-6 sm:py-6" style={{ minHeight: 300 }}>

          {/* ── PHASE 0: Typing ── */}
          {phase === 0 && (
            <div className="hero-chat-msg space-y-3">
              {/* AI greeting */}
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 text-[9px] font-extrabold text-black">D</div>
                <div className="max-w-[85%] rounded-bl-xl rounded-br-xl rounded-tr-xl border border-violet-500/15 bg-violet-500/[0.07] px-3 py-2 text-[13px] leading-relaxed text-zinc-300">
                  What do you want to build?
                </div>
              </div>
              {/* User typing */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-bl-xl rounded-br-xl rounded-tl-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
                  <div className="text-[13px] leading-relaxed text-emerald-100">
                    {DEMO_IDEA.slice(0, typedLen)}
                    <span className="inline-block w-[2px] h-[16px] bg-emerald-400 ml-0.5 animate-pulse align-middle" />
                  </div>
                </div>
              </div>
              {/* Launch button */}
              {typedLen >= DEMO_IDEA.length && (
                <div className="hero-chat-msg flex justify-end">
                  <div className="rounded-xl bg-emerald-400 px-5 py-2 text-[12px] font-bold text-black shadow-[0_0_20px_rgba(0,255,163,0.3)]">
                    Start Selling →
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PHASE 1: AI Building ── */}
          {phase === 1 && (
            <div className="space-y-3">
              {/* AI response */}
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 text-[9px] font-extrabold text-black">D</div>
                <div className="rounded-bl-xl rounded-br-xl rounded-tr-xl border border-violet-500/15 bg-violet-500/[0.07] px-3 py-2 text-[13px] text-zinc-300">
                  Building your business now...
                </div>
              </div>

              {/* Project name */}
              {buildStep >= 1 && (
                <div className="hero-chat-msg rounded-xl border border-emerald-400/15 bg-gradient-to-r from-emerald-400/[0.04] to-transparent p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-xl shadow-inner">🚗</div>
                    <div>
                      <div className="text-[15px] font-bold text-white">Sparkle Mobile Wash</div>
                      <div className="text-[10px] text-zinc-500">AI-generated project</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Offers */}
              {buildStep >= 2 && (
                <div className="hero-chat-msg space-y-1.5">
                  {[
                    { name: "Basic Wash", price: "$29", show: buildStep >= 2 },
                    { name: "Full Detail Package", price: "$89", show: buildStep >= 3 },
                    { name: "Monthly Membership", price: "$49/mo", show: buildStep >= 4 },
                  ].filter(o => o.show).map((offer) => (
                    <div key={offer.name} className="card-premium flex items-center justify-between rounded-lg border border-zinc-800/40 bg-gradient-to-r from-zinc-900/40 to-zinc-950 px-4 py-2.5">
                      <span className="text-[13px] text-zinc-300">{offer.name}</span>
                      <span className="text-[13px] font-bold text-emerald-400">{offer.price}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Status checks */}
              {buildStep >= 5 && (
                <div className="hero-chat-msg flex gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 text-[9px] font-extrabold text-black">D</div>
                  <div className="rounded-bl-xl rounded-br-xl rounded-tr-xl border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2 font-mono text-[10px] leading-[1.8] text-zinc-500">
                    <div className="text-zinc-600">✓ Storefront created</div>
                    {buildStep >= 6 && <div className="text-zinc-600">✓ Offers generated</div>}
                    {buildStep >= 6 && <div className="text-emerald-400">✓ Payments ready</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PHASE 2: Live Business (mini storefront) ── */}
          {phase === 2 && (
            <div className="hero-chat-msg">
              <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.05] to-violet-500/[0.03] overflow-hidden">
                {/* Storefront header — looks like a real project page */}
                {liveStep >= 1 && (
                  <div className="hero-chat-msg border-b border-zinc-800/30 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-800/50 bg-gradient-to-br from-zinc-900 to-zinc-950 text-xl shadow-inner">🚗</div>
                        <div>
                          <div className="text-[16px] font-bold text-white">Sparkle Mobile Wash</div>
                          <div className="text-[11px] text-zinc-500">dum.club/sparkle-wash</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">Live</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Storefront body */}
                <div className="px-5 py-4">
                  {/* Description */}
                  {liveStep >= 2 && (
                    <div className="hero-chat-msg mb-4">
                      <div className="text-[12px] text-zinc-400 mb-3">Premium mobile car detailing at your doorstep</div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {[
                          { name: "Basic Wash", price: "$29", tag: "Popular" },
                          { name: "Full Detail", price: "$89", tag: null },
                          { name: "Monthly Plan", price: "$49/mo", tag: "Subscription" },
                        ].map((o) => (
                          <div key={o.name} className="card-premium rounded-xl border border-zinc-800/40 bg-gradient-to-b from-zinc-900/40 to-transparent p-3 text-center">
                            <div className="text-[11px] text-zinc-400">{o.name}</div>
                            <div className="mt-1 text-[16px] font-extrabold text-emerald-400">{o.price}</div>
                            {o.tag && <div className="mt-1 text-[8px] font-bold uppercase tracking-widest text-emerald-400/50">{o.tag}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {liveStep >= 3 && (
                    <div className="hero-chat-msg flex items-center justify-between border-t border-zinc-800/30 pt-3 mb-3">
                      <div className="flex gap-2">
                        <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] text-zinc-400">🔗 Share</span>
                        <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] text-zinc-400">✏️ Edit</span>
                      </div>
                      <span className="rounded-xl bg-emerald-400 px-4 py-1.5 text-[11px] font-bold text-black shadow-[0_0_12px_rgba(0,255,163,0.2)]">View Store →</span>
                    </div>
                  )}

                  {/* Ready signal */}
                  {liveStep >= 4 && (
                    <div className="hero-chat-msg flex items-center gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
                      <span className="text-base">🎉</span>
                      <div>
                        <div className="text-[12px] font-semibold text-emerald-300">Ready for customers</div>
                        <div className="text-[9px] text-emerald-400/50">Shareable page · Stripe payments · AI support</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── PHASE 3: Purchase happens ── */}
          {phase === 3 && (
            <div className="hero-chat-msg space-y-3">
              <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.08] to-zinc-950 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">New Sale</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[14px] font-bold text-white">Full Detail Package</div>
                    <div className="text-[11px] text-zinc-500">Purchased just now</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[18px] font-bold text-emerald-400">+$89.00</div>
                    <div className="text-[9px] text-emerald-400/50">Revenue</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/30 p-2 text-center">
                    <div className="font-mono text-[14px] font-bold text-white">$89</div>
                    <div className="text-[8px] text-zinc-600">This sale</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/30 p-2 text-center">
                    <div className="font-mono text-[14px] font-bold text-emerald-400">+2</div>
                    <div className="text-[8px] text-zinc-600">DUM Points</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/30 p-2 text-center">
                    <div className="font-mono text-[14px] font-bold text-white">✓</div>
                    <div className="text-[8px] text-zinc-600">Paid via Stripe</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 bg-zinc-950 px-4 py-2">
          <span className="font-mono text-[9px] text-zinc-700">
            {phase === 0 ? "Describing..." : phase === 1 ? "Building..." : phase === 2 ? "Live ✓" : "Revenue ✓"}
          </span>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i <= phase ? "w-3 bg-emerald-400" : "w-1.5 bg-zinc-800"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Homepage Section Nav ─── */
const HOME_SECTIONS = [
  { id: "section-hero", label: "Top" },
  { id: "section-how", label: "How It Works" },
  { id: "section-features", label: "Features" },
  { id: "section-compare", label: "Why Us" },
  { id: "section-projects", label: "Projects" },
  { id: "section-stats", label: "Stats" },
  { id: "section-cta", label: "Get Started" },
];

/* ─── Live Sale Toast (cycles realistic sale notifications) ─── */
const SALE_NOTIFICATIONS = [
  { item: "Full Detail Package", price: "$89.00", time: "2m ago" },
  { item: "Monthly Membership", price: "$49.00", time: "5m ago" },
  { item: "8-Week Coaching Program", price: "$149.00", time: "8m ago" },
  { item: "Basic Exterior Wash", price: "$29.00", time: "12m ago" },
  { item: "Brand Design Package", price: "$299.00", time: "15m ago" },
  { item: "Resume Review Session", price: "$35.00", time: "22m ago" },
];

function LiveSaleToast() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show first toast after 4s, then cycle every 18s
    const initialDelay = setTimeout(() => setVisible(true), 4000);
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % SALE_NOTIFICATIONS.length);
        setVisible(true);
      }, 400);
    }, 18000);
    return () => { clearTimeout(initialDelay); clearInterval(cycle); };
  }, []);

  const sale = SALE_NOTIFICATIONS[idx];

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 transition-all duration-500 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-zinc-950/95 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_12px_rgba(0,255,163,0.06)] backdrop-blur-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/10 text-sm">
          💳
        </div>
        <div>
          <div className="text-[12px] font-semibold text-white">{sale.item}</div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="font-bold text-emerald-400">{sale.price}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{sale.time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Comparison Tabs: Features vs Cost ─── */
function ComparisonTabs() {
  const [tab, setTab] = useState<"features" | "cost">("features");

  return (
    <div className="mx-auto mt-10 max-w-4xl">
      {/* Tab buttons */}
      <div className="mb-6 flex items-center justify-center gap-1 rounded-xl border border-zinc-800/60 bg-zinc-950/80 p-1 max-w-xs mx-auto">
        <button
          onClick={() => setTab("features")}
          className={`flex-1 rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] transition-all duration-200 ${
            tab === "features"
              ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 shadow-[0_0_12px_rgba(0,255,163,0.08)]"
              : "text-zinc-500 border border-transparent hover:text-zinc-300"
          }`}
        >
          Why Us
        </button>
        <button
          onClick={() => setTab("cost")}
          className={`flex-1 rounded-lg px-4 py-2 text-[11px] font-bold uppercase tracking-[0.15em] transition-all duration-200 ${
            tab === "cost"
              ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 shadow-[0_0_12px_rgba(0,255,163,0.08)]"
              : "text-zinc-500 border border-transparent hover:text-zinc-300"
          }`}
        >
          Cost
        </button>
      </div>

      {/* ── FEATURES TABLE ── */}
      {tab === "features" && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]" style={{ minWidth: "560px" }}>
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-3 pr-4 text-left text-[9px] uppercase tracking-[0.12em] text-zinc-600"> </th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Base44</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Lovable</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Venice.ai</th>
                <th className="px-4 py-3 text-center text-[9px] uppercase tracking-[0.14em] text-emerald-400" style={{ background: "rgba(0,255,135,0.04)", borderRadius: "8px 8px 0 0", border: "1px solid rgba(0,255,135,0.12)", borderBottom: "none" }}>DUM Club ★</th>
              </tr>
            </thead>
            <tbody>
              {[
                { f: "What it builds", b: "Web apps", l: "Web apps", v: "AI models", d: "Revenue businesses" },
                { f: "Revenue on day one", b: "No", l: "No", v: "No", d: "Yes — Stripe built in" },
                { f: "Customer retention", b: "None", l: "None", v: "None", d: "DUM Points loyalty" },
                { f: "Marketplace", b: "None", l: "None", v: "None", d: "Discover — built in" },
                { f: "Blockchain", b: "None", l: "None", v: "Privacy chain", d: "Solana wallets" },
                { f: "Token ecosystem", b: "None", l: "None", v: "VEN (no commerce)", d: "DUM Points — on-chain loyalty" },
                { f: "Target user", b: "Developers", l: "Developers", v: "AI users", d: "Business owners" },
                { f: "End result", b: "An app prototype", l: "An app prototype", v: "AI output", d: "A running business" },
              ].map((row, i) => (
                <tr key={i} className="border-b border-zinc-800/40">
                  <td className="py-3 pr-4 text-[12px] font-medium text-zinc-500" style={{ fontFamily: "'DM Sans', sans-serif" }}>{row.f}</td>
                  <td className="px-3 py-3 text-center text-zinc-600">{row.b}</td>
                  <td className="px-3 py-3 text-center text-zinc-600">{row.l}</td>
                  <td className="px-3 py-3 text-center text-zinc-600">{row.v}</td>
                  <td className="px-4 py-3 text-center font-semibold text-emerald-400" style={{
                    background: "rgba(0,255,135,0.04)",
                    borderLeft: "1px solid rgba(0,255,135,0.12)",
                    borderRight: "1px solid rgba(0,255,135,0.12)",
                    ...(i === 7 ? { borderBottom: "1px solid rgba(0,255,135,0.12)", borderRadius: "0 0 8px 8px" } : {}),
                  }}>{row.d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── COST TABLE ── */}
      {tab === "cost" && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]" style={{ minWidth: "560px" }}>
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-3 pr-4 text-left text-[9px] uppercase tracking-[0.12em] text-zinc-600">Platform</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Energy Use</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Operating Cost</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-zinc-600">Model</th>
              </tr>
            </thead>
            <tbody>
              {[
                { p: "Amazon (AWS)", energy: "Power plant level", cost: "$100M+", model: "Infra provider", accent: false },
                { p: "Shopify", energy: "Very high", cost: "$10M+", model: "Commerce infra", accent: false },
                { p: "Venice / AI builders", energy: "High (AI-heavy)", cost: "$100K–$10M", model: "AI compute", accent: false },
                { p: "Base44 / Lovable", energy: "Medium-high", cost: "$50K–$1M", model: "AI + builder", accent: false },
                { p: "DUM Club (you)", energy: "LOW → Medium", cost: "$100 → $300K", model: "Marketplace + AI", accent: true },
              ].map((row, i) => (
                <tr key={i} className={`border-b border-zinc-800/40 ${row.accent ? "" : ""}`}
                  style={row.accent ? { background: "rgba(0,255,135,0.04)" } : {}}
                >
                  <td className={`py-4 pr-4 text-[12px] font-bold ${row.accent ? "text-emerald-400" : "text-zinc-400"}`} style={{ fontFamily: "'DM Sans', sans-serif" }}>
                    {row.accent && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(0,255,163,0.5)]" />}
                    {row.p}
                  </td>
                  <td className={`px-3 py-4 text-center ${row.accent ? "text-emerald-400 font-bold text-[13px]" : "text-zinc-600"}`}>
                    {row.energy}
                  </td>
                  <td className={`px-3 py-4 text-center ${row.accent ? "text-emerald-400 font-bold text-[13px]" : "text-zinc-600"}`}>
                    {row.cost}
                  </td>
                  <td className={`px-3 py-4 text-center ${row.accent ? "text-emerald-400 font-semibold" : "text-zinc-600"}`}>
                    {row.model}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Bottom callout */}
          <div className="mt-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.03] px-5 py-3 text-center">
            <span className="text-[12px] text-zinc-400">
              They burn millions to operate.{" "}
              <span className="font-bold text-emerald-400">DUM Club scales from $100 — and you keep the revenue.</span>
            </span>
          </div>
          <div className="mt-2 text-center text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-700">
            Solana wallet infrastructure · Stripe-powered payments
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [launchCount, setLaunchCount] = useState(0);

  // Load launch count on mount
  useEffect(() => { setLaunchCount(getLaunchCount()); }, []);

  // Live preview (debounced)
  const preview = useMemo(() => generatePreview(heroIdea), [heroIdea]);

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
          setHeroError("Daily creation limit reached. Try again tomorrow or upgrade.");
          return;
        }
        throw new Error(data?.detail || "Launch failed — please try again.");
      }
      const data = await res.json();
      localStorage.removeItem("pendingIdea");
      const newCount = incrementLaunchCount();
      setLaunchCount(newCount);
      // Award DUM Points for launching
      awardDumPoints(25);
      router.push(`/project/${data.project_id}?launched=1`);
    } catch (err) {
      setHeroLaunching(false);
      setHeroError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // ── Handle Launch button click ──
  function handleHeroLaunch() {
    if (!heroIdea.trim() || heroLaunching) return;
    // Check free limit
    if (getLaunchCount() >= FREE_LAUNCH_LIMIT) {
      setShowUpgradeModal(true);
      return;
    }
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
    const quality = allPublicProjects.filter((p) => !isPlaceholderDescription(p.description));
    const pool = quality.length > 0 ? quality : allPublicProjects;
    if (!pool.length) return null;
    let best: Project | null = null;
    let bestVol = -1;
    for (const p of pool) {
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
    return { project: pool[0], market: marketByProject[pool[0].id] };
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
    <div className="relative min-h-screen overflow-x-hidden bg-base text-white">
      <LiveSaleToast />
      {/* ── Upgrade Modal ── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowUpgradeModal(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-emerald-400/20 bg-zinc-950 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.6)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-3xl">🚀</div>
            <h2 className="text-xl font-extrabold text-white">You&apos;ve used your free businesses</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              You&apos;ve started {FREE_LAUNCH_LIMIT} businesses for free. Earn DUM Points to unlock unlimited businesses, priority placement, and more.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { icon: "♾️", label: "Unlimited businesses" },
                { icon: "⭐", label: "Featured placement" },
                { icon: "🤖", label: "Unlimited AI" },
              ].map((p) => (
                <div key={p.label} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-2 text-center">
                  <div className="text-base">{p.icon}</div>
                  <div className="mt-1 text-[9px] text-zinc-500">{p.label}</div>
                </div>
              ))}
            </div>
            <Link
              href="/upgrade"
              className="mt-5 block w-full rounded-xl bg-emerald-400 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-emerald-300"
            >
              View DUM Tiers →
            </Link>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(false)}
              className="mt-3 w-full rounded-xl px-6 py-2 text-sm text-zinc-600 transition hover:text-zinc-400"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      <Starfield count={130} />
      <HomeSectionNav />
      <section className="relative z-[1] mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        {/* ── HERO — Input-First ── */}
        <div id="section-hero" className="relative rounded-2xl border border-zinc-800/60 bg-base/80 backdrop-blur-sm">
          {/* Ambient background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
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

              {/* Eyebrow */}
              <div className="hero-entrance mb-4 text-[clamp(10px,2.5vw,13px)] font-bold uppercase tracking-[0.3em] text-zinc-500">
                Digital Utility Market
              </div>

              {/* Line 1 — the HERO line */}
              <h1 className="hero-entrance mt-3 text-[clamp(32px,9vw,72px)] font-black leading-[0.95] tracking-[-0.04em]">
                <span className="text-white">Sell anything.</span>
                <br />
                <span className="hero-text-glow">Reward everyone.</span>
              </h1>

              {/* Line 3 — supporting detail */}
              <p className="hero-entrance-delay-2 mx-auto mt-5 max-w-md text-[clamp(14px,3.5vw,18px)] font-normal leading-relaxed text-zinc-500">
                AI builds your storefront, offers, and payments.
                <br className="hidden sm:block" />
                You share the link. You get paid.
              </p>

              {/* ── LAUNCH INPUT ── */}
              <div className="hero-entrance-delay-3 mx-auto mt-10 max-w-2xl">
                <textarea
                  value={heroIdea}
                  onChange={(e) => setHeroIdea(e.target.value)}
                  placeholder="What does your business sell?"
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
                    "Start Selling →"
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

              {/* ── LIVE PREVIEW ── */}
              {preview && !heroLaunching && (
                <div className="hero-entrance-delay-2 mx-auto mt-5 max-w-2xl">
                  <div className="rounded-2xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.03] to-zinc-950 overflow-hidden">
                    <div className="flex items-center gap-2 border-b border-zinc-800/50 bg-zinc-950/80 px-4 py-2">
                      <div className="flex gap-1">
                        <div className="h-2 w-2 rounded-full bg-red-500/50" />
                        <div className="h-2 w-2 rounded-full bg-yellow-500/50" />
                        <div className="h-2 w-2 rounded-full bg-green-500/50" />
                      </div>
                      <span className="flex-1 text-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600">Preview</span>
                      <span className="text-[9px] text-emerald-400/50">AI</span>
                    </div>
                    <div className="px-4 py-3 space-y-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-sm">{preview.emoji}</div>
                        <div>
                          <div className="text-[14px] font-bold text-white">{preview.name}</div>
                          <div className="text-[10px] text-emerald-400/60">{preview.tag}</div>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {preview.offers.map((o) => (
                          <div key={o.title} className="flex items-center justify-between rounded-lg border border-zinc-800/30 bg-zinc-900/20 px-3 py-1.5">
                            <span className="text-[12px] text-zinc-400">{o.title}</span>
                            <span className="text-[12px] font-bold text-emerald-400">{o.price}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-1.5 text-[9px] text-zinc-600">
                        <span className="text-emerald-400/60">●</span> Storefront + Offers + Stripe payments
                      </div>
                      {preview.tag === "Entertainment Business" && (
                        <div className="mt-1.5 text-[9px] text-zinc-600 italic">
                          We turn your game concept into a business storefront with monetization built in.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── LAUNCH LIMIT INDICATOR ── */}
              {!heroLaunching && launchCount > 0 && launchCount < FREE_LAUNCH_LIMIT && (
                <div className="mx-auto mt-3 max-w-2xl text-center">
                  <span className="text-[11px] text-zinc-600">
                    {FREE_LAUNCH_LIMIT - launchCount} free business{FREE_LAUNCH_LIMIT - launchCount === 1 ? "" : "es"} remaining
                  </span>
                </div>
              )}

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
              <div className="hero-entrance-delay-2 mx-auto mt-6 space-y-3">
                <p className="text-[13px] text-zinc-600">
                  {allPublicProjects.length > 0 && (
                    <span className="text-emerald-400/70">{allPublicProjects.length} businesses live</span>
                  )}
                  {allPublicProjects.length > 0 && " · "}
                  Stripe checkout · Built on Solana · Live in 60 seconds
                </p>
                {/* Payment + chain icons */}
                <div className="flex items-center justify-center gap-4 text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-700">
                  <span className="flex items-center gap-1.5">
                    <svg width="20" height="13" viewBox="0 0 24 16" fill="none" className="text-zinc-600"><rect x="0.5" y="0.5" width="23" height="15" rx="2" stroke="currentColor"/><rect x="0" y="4" width="24" height="4" fill="currentColor" opacity="0.3"/></svg>
                    Visa
                  </span>
                  <span className="text-zinc-800">·</span>
                  <span className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-zinc-600"><circle cx="9" cy="12" r="7" stroke="currentColor" opacity="0.5"/><circle cx="15" cy="12" r="7" stroke="currentColor" opacity="0.5"/></svg>
                    Mastercard
                  </span>
                  <span className="text-zinc-800">·</span>
                  <span className="flex items-center gap-1.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-zinc-600"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.5"/></svg>
                    Solana
                  </span>
                  <span className="text-zinc-800">·</span>
                  <span className="text-zinc-600">Apple Pay</span>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ── Recent Sales Proof ── */}
        <RecentSalesFeed />

        {/* ── Platform Activity ── */}
        <div className="mx-auto mt-10 max-w-4xl">
          <PlatformActivity projectCount={allPublicProjects.length} />
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

          {/* ── Animated Product Demo ── */}
          <ProductDemo />
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
                title: "AI Business Builder",
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

        {/* DUM Club activity strip */}
        <div className="mx-auto mt-20 max-w-7xl border-t border-zinc-900">
          <DumActivityStrip projectCount={liveProjectCount} tradeCount={tradesInLast24h} />
        </div>

        {/* ── CONDENSED: WHY DUM CLUB WINS ── */}
        <div id="section-compare" className="border-t border-zinc-900 px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl text-center">
            <div className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
              The real difference
            </div>
            <h2 className="mx-auto max-w-2xl text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
              AI tools build apps.{" "}
              <span className="text-emerald-400" style={{ textShadow: "0 0 30px rgba(0,255,163,0.25)" }}>
                DUM Club builds businesses that sell.
              </span>
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-zinc-500">
              From idea → storefront → payments → customers → repeat revenue. Instantly.
            </p>
          </div>

          {/* ── Tab switcher ── */}
          <ComparisonTabs />

          {/* Compact win cards */}
          <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: "🚫", title: "No developer needed", color: "#FF6B6B" },
              { icon: "💰", title: "Sell on day one", color: "#00FF87" },
              { icon: "🤖", title: "AI runs your business", color: "#A78BFA" },
              { icon: "🔁", title: "Customers come back", color: "#38BDF8" },
            ].map((c) => (
              <div key={c.title} className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4 text-center transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.02]">
                <div className="mb-2 text-xl">{c.icon}</div>
                <div className="text-[12px] font-bold text-zinc-300">{c.title}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link
              href="/business"
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-6 py-3 text-[13px] font-bold text-emerald-400 transition hover:bg-emerald-400/10 hover:border-emerald-400/40"
            >
              See full comparison →
            </Link>
          </div>
        </div>

        {/* Featured project spotlight */}
        <div id="section-projects" className="border-t border-zinc-900 px-4 py-20 sm:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="mb-4 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
              Featured business
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
                          {featured.project.title || featured.project.name || "New Business"}
                        </div>
                        <div className="mt-1 max-w-lg text-sm leading-relaxed text-zinc-300">
                          {featured.project.description || "No description yet."}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[10px] text-emerald-400">
                            DUM Points accepted
                          </span>
                          <span className="rounded-full border border-zinc-800 px-3 py-1 text-[10px] text-zinc-500">
                            {featured.project.token_utility || "Member perks available"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1">
                        <span className="text-[10px] font-bold text-emerald-400">DUM Points</span>
                        <span className="text-[10px] text-emerald-400/60">for discounts</span>
                      </div>
                      <div className="mt-3 inline-block rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-black transition group-hover:bg-emerald-400">
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
                { label: "Stripe payments", value: "✓" },
                { label: "Business categories", value: "5+" },
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
              Describe any idea — a service, a product, an experience. AI builds the storefront, offers, and payments. You share the link and start earning.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/build"
                className="rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_24px_rgba(0,255,163,0.25)]"
              >
                Start Selling Free →
              </Link>
              <Link
                href="/discover"
                className="rounded-xl border border-zinc-700 px-8 py-4 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Browse Live Businesses
              </Link>
            </div>
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] px-5 py-3 text-center text-[12px] text-zinc-400">
              <span className="text-emerald-400">◆</span> Every purchase earns DUM Points — redeemable at <strong className="text-zinc-300">any</strong> business on the platform.
            </div>
          </div>
        </div>
      </section>

      {/* Latest — real public projects */}
      <div className="border-t border-zinc-900 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 text-xs font-bold uppercase tracking-[0.3em] text-zinc-500">
            Recently Added
          </div>
          {latestProjectsNews.length === 0 && !loadingProjects ? (
            <p className="text-sm text-zinc-500">
              {allPublicProjects.length === 0
                ? "No businesses yet — be the first to go live."
                : "New businesses will appear here as they go live."}
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
                        {p.title || p.name || "New Business"}
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
            {["Solana", "Stripe", "Supabase", "Next.js"].map((name) => (
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
              </div>
              <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                Digital Utility Market
              </p>
              <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
                Turn any idea into a live business with payments, loyalty, and a storefront — in 60 seconds. Built on Solana.
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
                  { label: "Start a business", href: "/build" },
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
                  {
                    label: "Instagram @julez_future",
                    href: "https://instagram.com/julez_future",
                  },
                  {
                    label: "Contact",
                    href: "mailto:julian@topgunmaintenance.com",
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
                  { label: "For Business", href: "/business" },
                  { label: "Discover", href: "/discover" },
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
              is built on Solana and operates in early access.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="text-[10px] text-zinc-700">
                © {new Date().getFullYear()} DUM Club. All rights reserved.
              </div>
              <div className="flex gap-6">
                <div className="flex gap-6">
                  <Link href="/terms" className="text-[10px] text-zinc-700 transition hover:text-zinc-400">
                    Terms of Use
                  </Link>
                  <Link href="/privacy" className="text-[10px] text-zinc-700 transition hover:text-zinc-400">
                    Privacy Policy
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
