"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Starfield } from "../components/Starfield";
import { ProofOfPurchaseModal } from "../components/ProofOfPurchaseModal";
import { ProofOfMotion } from "../components/ProofOfMotion";
import { FounderNote } from "../components/FounderNote";
import { useAuth } from "../lib/auth/AuthContext";
import { speakText, stopSpeaking, canSpeak } from "../lib/speech";
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
  is_live?: boolean;
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

import { API_BASE } from "../lib/apiBase";

// Feature flag: use backend search endpoint instead of client-side filtering.
// Set to false to roll back to the previous client-side behaviour.
const USE_BACKEND_SEARCH = true;

// ── Intent detection: FIND (search/buy) vs CREATE (build business) ──
const FIND_PHRASES = [
  "find", "near me", "looking for", "where can i", "i need", "i want to buy",
  "who does", "who sells", "best", "cheapest", "get a", "get me", "buy",
  "search", "show me", "any", "recommend", "suggestion", "where to",
  "nearby", "around here", "close to me", "open now", "how much",
  "price", "cost", "affordable", "cheap",
];

const CREATE_PHRASES = [
  "i want to sell", "i want to start", "help me sell", "help me build",
  "create a", "build a", "launch a", "start a", "turn this into",
  "make a business", "my business", "i sell", "i offer", "i provide",
  "selling", "offering", "providing", "building", "creating", "launching", "starting",
];

const SERVICE_CATEGORIES = [
  "pizza", "taco", "burger", "sushi", "coffee", "bakery", "restaurant",
  "car wash", "cleaning", "plumber", "electrician", "mechanic", "barber",
  "salon", "spa", "gym", "yoga", "trainer", "tutor", "lawyer",
  "accountant", "photographer", "designer", "developer", "chef",
  "catering", "landscaping", "painting", "roofing", "moving",
  "pet", "dog", "grooming", "daycare", "dentist", "doctor",
  "massage", "nail", "laundry", "tailor", "florist",
  "meal prep", "house cleaning", "car detailing", "dog walking",
];

function detectIntent(text: string): "find" | "create" {
  const lower = text.toLowerCase().trim();
  if (!lower) return "create";

  // Explicit CREATE phrases win first
  for (const phrase of CREATE_PHRASES) {
    if (lower.includes(phrase)) return "create";
  }

  // Explicit FIND phrases
  for (const phrase of FIND_PHRASES) {
    if (lower.includes(phrase)) return "find";
  }

  // Questions are usually searches
  if (lower.startsWith("is there") || lower.startsWith("do you") || lower.startsWith("can i") || lower.endsWith("?")) return "find";

  // Known service/category terms → FIND (unless long phrase with business-building signal)
  const words = lower.split(/\s+/);
  const hasCategory = SERVICE_CATEGORIES.some((cat) => lower.includes(cat));
  if (hasCategory) {
    if (words.length >= 5) {
      const bizSignals = ["business", "company", "brand", "agency", "subscription",
        "for busy", "for small", "for local", "monthly service", "premium service",
        "that offers", "that provides", "that sells", "that delivers"];
      if (bizSignals.some((s) => lower.includes(s))) return "create";
      // Article-led long descriptions: "A mobile car wash service" → CREATE
      if (lower.startsWith("a ") || lower.startsWith("an ")) return "create";
    }
    return "find";
  }

  // Short noun-style queries (1-4 words) without create language → FIND
  if (words.length <= 4) return "find";

  // Longer phrases default to CREATE (likely business descriptions)
  return "create";
}

function extractCity(text: string): string {
  const m = text.toLowerCase().match(/\bin\s+([a-z][a-z\s]{1,20})$/);
  return m ? m[1].trim().replace(/^./, (c) => c.toUpperCase()) : "";
}

const FIND_STRIP_RE = /^(find|find me|search|search for|looking for|i need|i want|get me|show me|where can i|where can i get|where can i find|who does|who sells)\s*/i;
const LOCAL_STRIP_RE = /\s*(near me|nearby|around here|close to me|in my area)\s*/i;

function stripFindPrefixes(text: string): string {
  return text
    .replace(FIND_STRIP_RE, "")
    .replace(LOCAL_STRIP_RE, "")
    .replace(/\s*in\s+[a-z\s]+$/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .trim();
}

function findQueryToCreatePrompt(query: string, city: string): string {
  const cleaned = stripFindPrefixes(query);
  return `A ${cleaned} business${city ? ` in ${city}` : ""}`;
}

const TEMPLATE_STARTERS = [
  { label: "Sell coaching", prompt: "A personal training service selling custom workout plans and meal prep packages" },
  { label: "Find services", prompt: "Find me a mobile car wash or detailing service near me" },
  { label: "Sell products", prompt: "A local bakery selling custom cakes, pastries, and catering" },
  { label: "Find food", prompt: "Find me a meal prep or catering service" },
  { label: "Sell design", prompt: "A freelance design studio offering logo, brand, and web packages" },
  { label: "Find designers", prompt: "Find me a logo designer or brand studio" },
  { label: "Sell digital goods", prompt: "A creator selling online courses, templates, and digital downloads" },
  { label: "Find courses", prompt: "Find me online courses or digital templates" },
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
  return Number(localStorage.getItem("dum_points") || "0");
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
      { at: 9600, fn: () => setLiveStep(3) },  // AI assistant appears
      { at: 10400, fn: () => setLiveStep(4) }, // Actions + Buy Now
      { at: 11200, fn: () => setLiveStep(5) }, // Ready signal
      // Purchase simulation
      { at: 12500, fn: () => setPhase(3) },
      // Clean restart
      { at: 15500, fn: () => setLoopKey((k) => k + 1) },
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
                          { name: "Basic Wash", price: "$29", tag: null },
                          { name: "Full Detail", price: "$89", tag: "Most popular" },
                          { name: "Monthly Plan", price: "$49/mo", tag: "Subscription" },
                        ].map((o) => (
                          <div key={o.name} className={`card-premium rounded-xl border bg-gradient-to-b from-zinc-900/40 to-transparent p-3 text-center ${o.tag === "Most popular" ? "border-emerald-400/30" : "border-zinc-800/40"}`}>
                            <div className="text-[11px] text-zinc-400">{o.name}</div>
                            <div className="mt-1 text-[16px] font-extrabold text-emerald-400">{o.price}</div>
                            {o.tag && <div className={`mt-1 text-[8px] font-bold uppercase tracking-widest ${o.tag === "Most popular" ? "text-emerald-400" : "text-emerald-400/50"}`}>{o.tag}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI assistant helping sell */}
                  {liveStep >= 3 && (
                    <div className="hero-chat-msg mb-3 rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-400/15 text-[8px] font-bold text-orange-400 border border-orange-400/20">SM</div>
                        <div className="flex-1">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1">AI Sales Assistant</div>
                          <div className="text-[11px] leading-relaxed text-zinc-400">
                            Most customers go with the Full Detail at $89 — it covers interior, exterior, and wax. Great value for the price.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {liveStep >= 4 && (
                    <div className="hero-chat-msg flex items-center justify-between border-t border-zinc-800/30 pt-3 mb-3">
                      <div className="flex gap-2">
                        <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] text-zinc-400">🔗 Share</span>
                        <span className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[10px] text-zinc-400">💬 Ask AI</span>
                      </div>
                      <span className="rounded-xl bg-emerald-400 px-4 py-1.5 text-[11px] font-bold text-black shadow-[0_0_12px_rgba(0,255,163,0.2)]">Buy Now →</span>
                    </div>
                  )}

                  {/* Ready signal */}
                  {liveStep >= 5 && (
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
                    <div className="text-[11px] text-zinc-500">Sarah M. just purchased</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[22px] font-black text-emerald-400">+$89</div>
                    <div className="text-[9px] text-emerald-400/50">Your revenue</div>
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
      className={`fixed bottom-4 left-4 z-50 hidden transition-all duration-500 lg:block ${
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
                { f: "Payouts", b: "—", l: "—", v: "—", d: "Stripe direct, ~2-day" },
                { f: "Token rewards", b: "None", l: "None", v: "VEN (no commerce)", d: "DUM Points — real loyalty currency" },
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
            Verified merchants · Stripe-powered payments
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
  const [listening, setListening] = useState(false);
  const heroIntent = detectIntent(heroIdea);
  const [ctaRotation, setCtaRotation] = useState(0);
  const [ctaHovered, setCtaHovered] = useState(false);
  const ctaLabels = ["Start Selling →", "Start Buying →"];
  const [findResults, setFindResults] = useState<Project[] | null>(null);
  const [findLoading, setFindLoading] = useState(false);
  const [findCity, setFindCity] = useState("");
  const [findSuggestSent, setFindSuggestSent] = useState(false);
  const [findTopOffer, setFindTopOffer] = useState<{ title: string; price: number; label: string; reason: string } | null>(null);
  // AI agent layer state
  const [findExplanation, setFindExplanation] = useState("");
  const [findAiExplanation, setFindAiExplanation] = useState("");
  const [findAiFading, setFindAiFading] = useState(false);
  const [findAckLine, setFindAckLine] = useState("");
  const findExplainGenRef = useRef(0);
  const [findRefineInput, setFindRefineInput] = useState("");
  const refineInputRef = useRef<HTMLInputElement>(null);
  const [findAllOffers, setFindAllOffers] = useState<{ title: string; price: number; sold: number }[]>([]);
  // Offer data for alternative projects (keyed by project id)
  const [findAltOffers, setFindAltOffers] = useState<Record<string, { title: string; price: number }>>({});
  // Off-platform nearby results
  const [findExternalResults, setFindExternalResults] = useState<{ id: string; name: string; address: string; category: string; rating: number | null; review_count: number; external_source: string; external_place_id: string }[]>([]);
  const [proofModalBiz, setProofModalBiz] = useState<{ id: string; name: string } | null>(null);
  const [proofRewardsEnabled, setProofRewardsEnabled] = useState(false);
  // Multi-turn refinement context
  const [refineHistory, setRefineHistory] = useState<{ reason: string; offerTitle: string }[]>([]);
  const [refineListening, setRefineListening] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  // Voice output state
  const voiceInitiatedRef = useRef(false);
  const [voiceMuted, setVoiceMuted] = useState(false);

  // Rotate CTA when idle (no text typed, not launching, not hovered)
  useEffect(() => {
    if (heroIdea.trim() || heroLaunching || ctaHovered) return;
    const t = setInterval(() => setCtaRotation((r) => (r + 1) % 2), 3500);
    return () => clearInterval(t);
  }, [heroIdea, heroLaunching, ctaHovered]);

  // Debounce auto-search for FIND intent (500ms pause triggers search)
  const heroLaunchRef = useRef(handleHeroLaunch);
  heroLaunchRef.current = handleHeroLaunch;
  useEffect(() => {
    if (!heroIdea.trim() || heroLaunching || heroIntent !== "find" || findResults !== null) return;
    const t = setTimeout(() => heroLaunchRef.current(), 500);
    return () => clearTimeout(t);
  }, [heroIdea, heroIntent, heroLaunching, findResults]);

  // Load launch count on mount
  useEffect(() => { setLaunchCount(getLaunchCount()); }, []);

  // Referral tracking: store ref code and track click
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && ref.startsWith("DUM-")) {
      localStorage.setItem("dum_referral_code", ref);
      fetch(`${API_BASE}/api/referrals/click/${ref}`, { method: "POST" }).catch(() => {});
    }
  }, []);

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

  // ── Check URL param or localStorage for pending idea on mount ──
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlIdea = params.get("idea");
      if (urlIdea) {
        setHeroIdea(urlIdea);
        // Clean the URL
        const clean = new URL(window.location.href);
        clean.searchParams.delete("idea");
        window.history.replaceState({}, "", clean.toString());
        return;
      }
    }
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

    // FIND intent → inline search results
    if (heroIntent === "find") {
      setFindLoading(true);
      setFindSuggestSent(false);
      const rawQ = heroIdea.toLowerCase().trim();
      const city = extractCity(rawQ);
      if (city) setFindCity(city);

      // Reset state for new search
      stopSpeaking();
      setFindTopOffer(null);
      setFindExplanation("");
      setFindAiExplanation("");
      setFindAiFading(false);
      setFindAckLine("");
      setRefineHistory([]);
      setShowAlternatives(false);
      findExplainGenRef.current++;
      setFindRefineInput("");
      setFindAllOffers([]); setFindAltOffers({}); setFindExternalResults([]);

      if (USE_BACKEND_SEARCH) {
        // ── Backend search (v1) ──
        fetch(`${API_BASE}/api/search/homepage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: heroIdea, city: city || "" }),
        })
          .then((r) => r.ok ? r.json() : null)
          .then((data) => {
            // Store external nearby results regardless of DUM Club match
            setFindExternalResults(data?.nearby_external || []);

            if (!data || (data.fallback_needed && !(data.nearby_external?.length))) {
              // No match and no external results → fallback card
              setFindResults([]);
              setFindLoading(false);
              if (voiceInitiatedRef.current && !voiceMuted) {
                speakText(`No results found for ${stripFindPrefixes(heroIdea)}. You can search nearby or create this business on DUM Club.`);
              }
              return;
            }
            if (data.fallback_needed && data.nearby_external?.length) {
              // No DUM match but external results exist → show empty DUM + external section
              setFindResults([]);
              setFindLoading(false);
              if (voiceInitiatedRef.current && !voiceMuted) {
                const extNames = (data.nearby_external as any[]).slice(0, 2).map((e: any) => e.name).join(" and ");
                speakText(`No DUM Club businesses match, but I found nearby options like ${extNames}. You can earn DUM Points for verified purchases there.`);
              }
              return;
            }

            // Map backend response → existing state shape
            const best = data.best_match;
            const topProjects: Project[] = [];
            if (best?.project) {
              topProjects.push({
                id: best.project.id,
                title: best.project.title,
                description: best.project.description,
                template_type: best.project.category,
              } as Project);
            }
            const altOfferMap: Record<string, { title: string; price: number }> = {};
            for (const opt of data.other_options || []) {
              if (opt?.project) {
                topProjects.push({
                  id: opt.project.id,
                  title: opt.project.title,
                  description: opt.project.description,
                  template_type: opt.project.category,
                } as Project);
                if (opt.offer) {
                  altOfferMap[opt.project.id] = { title: opt.offer.title, price: Number(opt.offer.price_usd || 0) };
                }
              }
            }
            setFindResults(topProjects);
            setFindAltOffers(altOfferMap);
            setFindLoading(false);

            if (best?.offer) {
              const allOffers = (best.all_offers || []).map((o: any) => ({
                title: o.title, price: Number(o.price_usd || 0), sold: Number(o.sold || 0),
              }));
              setFindAllOffers(allOffers);
              const pickTitle = best.offer.title;
              const pickPrice = Number(best.offer.price_usd || 0);
              setFindTopOffer({ title: pickTitle, price: pickPrice, label: best.offer.label, reason: best.offer.reason });
              setFindExplanation(best.explanation || "");

              // Async AI explanation
              const gen = ++findExplainGenRef.current;
              fetch(`${API_BASE}/api/ai/homepage-explain`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: heroIdea,
                  city: city || findCity,
                  matched_project: best.project,
                  offers: allOffers.map((o: any) => ({ title: o.title, price: o.price, sold: o.sold })),
                  highlighted_offer: { title: pickTitle, price: pickPrice, label: best.offer.label, reason: best.offer.reason },
                  alternative_title: topProjects.length > 1 ? (topProjects[1].title || "") : "",
                  nearby_external_count: (data.nearby_external || []).length,
                }),
              })
                .then((r) => r.ok ? r.json() : null)
                .then((aiData) => {
                  if (aiData?.explanation && findExplainGenRef.current === gen) {
                    setFindAiFading(true);
                    setTimeout(() => {
                      setFindAiExplanation(aiData.explanation);
                      setFindAiFading(false);
                      if (voiceInitiatedRef.current && !voiceMuted) speakText(aiData.explanation);
                    }, 150);
                  } else if (voiceInitiatedRef.current && !voiceMuted && findExplainGenRef.current === gen) {
                    speakText(best.explanation || "");
                  }
                })
                .catch(() => { if (voiceInitiatedRef.current && !voiceMuted) speakText(best.explanation || ""); });
            }
          })
          .catch(() => {
            // Backend search failed — show fallback
            setFindResults([]);
            setFindLoading(false);
          });
      } else {
        // ── Legacy client-side search (fallback) ──
        const q = stripFindPrefixes(rawQ).toLowerCase();
        let matches = allPublicProjects.filter((p) => {
          if (!q) return false;
          const title = (p.title || p.name || "").toLowerCase();
          const desc = (p.description || "").toLowerCase();
          const words = q.split(/\s+/).filter((w) => w.length > 2);
          return words.some((w) => title.includes(w) || desc.includes(w));
        });
        if (city) {
          const cityLower = city.toLowerCase();
          matches.sort((a, b) => {
            const aCity = (a.description || "").toLowerCase().includes(cityLower) ? 1 : 0;
            const bCity = (b.description || "").toLowerCase().includes(cityLower) ? 1 : 0;
            return bCity - aCity;
          });
        }
        const topMatches = matches.slice(0, 2);
        setFindResults(topMatches);
        setFindLoading(false);
        if (topMatches.length > 0) {
          fetch(`${API_BASE}/api/offers/${topMatches[0].id}`)
            .then((r) => r.ok ? r.json() : [])
            .then((offers: any[]) => {
              if (!offers.length) return;
              const active = offers.filter((o: any) => o.is_active !== false);
              if (!active.length) return;
              const allSorted = [...active]
                .sort((a: any, b: any) => (a.price_usd || 0) - (b.price_usd || 0))
                .map((o: any) => ({ title: o.title, price: Number(o.price_usd || 0), sold: Number(o.quantity_sold || 0) }));
              setFindAllOffers(allSorted);
              const bestSeller = active.reduce((best: any, o: any) => (o.quantity_sold || 0) > (best.quantity_sold || 0) ? o : best, active[0]);
              let pick: any; let label: string; let explanation: string; let reason: string;
              if ((bestSeller.quantity_sold || 0) > 0) {
                pick = bestSeller; label = "Most popular"; reason = "best_seller";
                explanation = `Most customers go with ${pick.title} at $${Math.round(Number(pick.price_usd))}. ${allSorted.length > 1 ? `${allSorted.length - 1} other option${allSorted.length > 2 ? "s" : ""} available.` : ""}`;
              } else if (allSorted.length >= 3) {
                pick = active.sort((a: any, b: any) => (a.price_usd || 0) - (b.price_usd || 0))[Math.floor(active.length / 2)];
                label = "Best value"; reason = "mid_tier";
                explanation = `${pick.title} at $${Math.round(Number(pick.price_usd))} is the best balance of price and scope.`;
              } else if (allSorted.length === 2) {
                pick = allSorted[0]; label = "Starting from"; reason = "cheapest";
                explanation = `Starts at $${Math.round(pick.price)}. There's also a $${Math.round(allSorted[1].price)} option with more included.`;
              } else {
                pick = allSorted[0]; label = "Available now"; reason = "only";
                explanation = `${pick.title} is available for $${Math.round(pick.price)}. A solid choice to start with.`;
              }
              const pickTitle = pick.title || pick.name;
              const pickPrice = Number(pick.price_usd || pick.price || 0);
              setFindTopOffer({ title: pickTitle, price: pickPrice, label, reason });
              setFindExplanation(explanation);
              const gen = ++findExplainGenRef.current;
              fetch(`${API_BASE}/api/ai/homepage-explain`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: heroIdea, city: findCity,
                  matched_project: { id: topMatches[0].id, title: topMatches[0].title || topMatches[0].name || "", description: topMatches[0].description || "", category: topMatches[0].template_type || "" },
                  offers: allSorted.map((o) => ({ title: o.title, price: o.price, sold: o.sold })),
                  highlighted_offer: { title: pickTitle, price: pickPrice, label, reason },
                  alternative_title: topMatches.length > 1 ? (topMatches[1].title || topMatches[1].name || "") : "",
                }),
              })
                .then((r) => r.ok ? r.json() : null)
                .then((data) => {
                  if (data?.explanation && findExplainGenRef.current === gen) {
                    setFindAiFading(true);
                    setTimeout(() => { setFindAiExplanation(data.explanation); setFindAiFading(false);
                      if (voiceInitiatedRef.current && !voiceMuted) speakText(data.explanation);
                    }, 150);
                  } else if (voiceInitiatedRef.current && !voiceMuted && findExplainGenRef.current === gen) { speakText(explanation); }
                })
                .catch(() => { if (voiceInitiatedRef.current && !voiceMuted) speakText(explanation); });
            })
            .catch(() => {});
        }
      }
      // Scroll to results only if they'd be below the viewport
      setTimeout(() => {
        const el = document.getElementById("find-results");
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top > window.innerHeight) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }, 100);
      return;
    }

    // CREATE intent → existing launch flow
    if (getLaunchCount() >= FREE_LAUNCH_LIMIT) {
      setShowUpgradeModal(true);
      return;
    }
    if (!user) {
      localStorage.setItem("pendingIdea", heroIdea.trim());
      setPendingAutoLaunch(true);
      login();
      return;
    }
    if (!walletAddress) {
      localStorage.setItem("pendingIdea", heroIdea.trim());
      setPendingAutoLaunch(true);
      createWallet().catch(() => {});
      return;
    }
    doHeroLaunch(heroIdea.trim());
  }

  // ── Voice input via Web Speech API ──
  function startVoiceInput() {
    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setHeroIdea(transcript);
      voiceInitiatedRef.current = true;
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
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

  // Projects that are CURRENTLY streaming (is_live === true) — drives the
  // dynamic hero banner. Falls back to the no-streams value-prop state when
  // this list is empty OR when the live-streams hero is disabled by env flag.
  //
  // The feature flag NEXT_PUBLIC_ENABLE_LIVE_STREAMS defaults to OFF per the
  // local-services wedge strategy (Master Playbook Phase 0/1). The Whatnot-
  // style live commerce hero is dormant code, not deleted code — flip the
  // env var on in Vercel to re-enable when the live-commerce loop matters
  // again (Phase 3+ at the earliest).
  const liveStreamsEnabled = process.env.NEXT_PUBLIC_ENABLE_LIVE_STREAMS === "true";
  const liveStreamingProjects = useMemo(
    () =>
      liveStreamsEnabled
        ? allPublicProjects.filter((p) => p.is_live === true).slice(0, 4)
        : [],
    [allPublicProjects, liveStreamsEnabled]
  );

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
    fetch(`${API_BASE}/api/flags`).then((r) => r.ok ? r.json() : { off_platform_receipt_rewards_enabled: false } as Record<string, boolean>).then((flags: Record<string, boolean>) => {
      if (flags.off_platform_receipt_rewards_enabled) setProofRewardsEnabled(true);
    }).catch(() => {});
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
    }, 45000);

    return () => {
      if (marketPollRef.current) clearInterval(marketPollRef.current);
    };
  }, [allPublicProjects]);

  return (
    <div className="relative min-h-screen bg-base text-white" style={{ overflowX: "clip" }}>
      <LiveSaleToast />
      {/* ── Upgrade Modal ── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowUpgradeModal(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-emerald-400/20 bg-zinc-950 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.6)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-3xl">🚀</div>
            <h2 className="text-xl font-extrabold text-white">You&apos;ve used your free businesses</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              You&apos;ve started {FREE_LAUNCH_LIMIT} businesses for free. Earn DUM Points for unlimited businesses, priority placement, and more.
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

      <Starfield count={60} />
      <HomeSectionNav />
      <section className="relative z-[1] mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
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

          <div className="relative px-6 py-10 sm:px-10 sm:py-12 lg:px-16 lg:py-14">

            {/* ── DYNAMIC HERO BANNER ──────────────────────────────
                 When streams are live: LIVE NOW + stream cards.
                 Otherwise: "Earn rewards everywhere. Redeem anywhere."
                 + two CTAs (Start Shopping, List Your Business Free).
                 Sits above the interactive launch input below. */}
            {liveStreamingProjects.length > 0 ? (
              <div className="mx-auto mb-10 max-w-5xl">
                <div className="mb-4 flex items-center justify-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red-400">
                    Live Now on DUM Club
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {liveStreamingProjects.map((p) => (
                    <Link
                      key={p.id}
                      href={`/project/${p.id}`}
                      className="group relative overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.04] to-zinc-950 p-4 text-left transition hover:border-red-500/40 hover:shadow-[0_0_24px_rgba(239,68,68,0.12)]"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                          </span>
                          <span className="text-[8px] font-bold uppercase tracking-[0.18em] text-red-400">
                            Live
                          </span>
                        </div>
                        <span className="text-[16px]">{getProjectEmoji(p, 0)}</span>
                      </div>
                      <div className="text-[14px] font-bold leading-tight text-white line-clamp-2">
                        {p.title || p.name || "Live business"}
                      </div>
                      <div className="mt-2 text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-500 transition group-hover:text-red-400">
                        Watch now →
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="mt-4 text-center">
                  <Link
                    href="/discover"
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500 transition hover:text-emerald-400"
                  >
                    See every live business →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="mx-auto mb-10 max-w-3xl text-center">
                <h2 className="text-[clamp(22px,5vw,34px)] font-black leading-[1.05] tracking-[-0.02em] text-white">
                  Earn rewards everywhere.
                  <br />
                  <span className="hero-text-glow">Redeem anywhere.</span>
                </h2>
                <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row sm:gap-3">
                  <Link
                    href="/discover"
                    className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-400 px-5 text-[12px] font-bold uppercase tracking-[0.15em] text-black transition hover:bg-emerald-300 hover:shadow-[0_0_24px_rgba(0,255,163,0.3)]"
                  >
                    Start Shopping →
                  </Link>
                  <Link
                    href="/merchant"
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/60 px-5 text-[12px] font-bold uppercase tracking-[0.15em] text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-400"
                  >
                    List Your Business Free
                  </Link>
                </div>
              </div>
            )}
            {/* ── /DYNAMIC HERO BANNER ───────────────────────────── */}

            <div className="mx-auto max-w-3xl text-center">

              {/* ── LAUNCH INPUT ── */}
              <div className="hero-entrance-delay-3 mx-auto mt-6 max-w-2xl">
                <div className="relative">
                  <textarea
                    value={heroIdea}
                    onChange={(e) => { setHeroIdea(e.target.value); voiceInitiatedRef.current = false; if (findResults !== null) { stopSpeaking(); setFindResults(null); setFindTopOffer(null); setFindExplanation(""); setFindAiExplanation(""); setFindAiFading(false); setFindAckLine(""); setRefineHistory([]); findExplainGenRef.current++; setFindAllOffers([]); setFindAltOffers({}); setFindExternalResults([]); setFindRefineInput(""); } }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleHeroLaunch(); } }}
                    placeholder="What do you want to find or build?"
                    rows={3}
                    disabled={heroLaunching}
                    className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950/80 px-5 py-4 pr-14 text-base leading-relaxed text-white placeholder-zinc-600 outline-none transition focus:border-emerald-400/60 disabled:opacity-50"
                  />
                  {/* Voice input button */}
                  <button
                    type="button"
                    onClick={startVoiceInput}
                    disabled={heroLaunching || listening}
                    className={`absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                      listening
                        ? "border-red-400/40 bg-red-400/10 text-red-400 animate-pulse"
                        : "border-zinc-700 bg-zinc-900/80 text-zinc-500 hover:border-emerald-400/30 hover:text-emerald-400"
                    }`}
                    title={listening ? "Listening..." : "Voice input"}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </button>
                </div>

                {/* Intent-aware CTA with idle rotation */}
                <button
                  type="button"
                  onClick={handleHeroLaunch}
                  onMouseEnter={() => setCtaHovered(true)}
                  onMouseLeave={() => setCtaHovered(false)}
                  disabled={!heroIdea.trim() || heroLaunching}
                  className={`mt-3 w-full rounded-2xl px-8 py-4 text-sm font-bold uppercase tracking-[0.15em] transition-all duration-300 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50 ${
                    heroIdea.trim()
                      ? heroIntent === "find"
                        ? "bg-sky-400 text-black hover:bg-sky-300 hover:shadow-[0_0_40px_rgba(56,189,248,0.35)]"
                        : "bg-emerald-400 text-black hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.35)]"
                      : "bg-emerald-400 text-black hover:bg-emerald-300 hover:shadow-[0_0_40px_rgba(0,255,163,0.35)]"
                  }`}
                  style={{ minHeight: "56px" }}
                >
                  {heroLaunching ? (
                    <span className="flex items-center justify-center gap-3">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                      <span key={heroProgress} className="animate-fade-in">
                        {LAUNCH_PROGRESS[heroProgress]}
                      </span>
                    </span>
                  ) : heroIdea.trim() ? (
                    heroIntent === "find" ? "Find It →" : "Start Selling →"
                  ) : (
                    <span key={ctaRotation} className="inline-block animate-fade-in">
                      {ctaLabels[ctaRotation]}
                    </span>
                  )}
                </button>

                {/* Tagline / intent hint */}
                {!heroLaunching && (
                  <p className="mt-4 text-center text-[12px] font-medium tracking-[0.15em] text-zinc-500">
                    {heroIdea.trim()
                      ? heroIntent === "find" ? "Looking for a service" : "Creating a business"
                      : "Sell anything. Buy anything. Reward everyone."}
                  </p>
                )}

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

              {/* ── PROOF OF MOTION (or FounderNote fallback) ─────
                   Strict 4-cell honest-data rule (Phase 0A). Renders the
                   stats grid only when ALL 4 cells are >0 with real
                   30-day-window data. Otherwise renders FounderNote in
                   the same vertical slot — never empty space. */}
              <ProofOfMotion fallback={<FounderNote />} />

              {/* ── INLINE FIND RESULTS ── */}
              {findResults !== null && !heroLaunching && (
                <div id="find-results" className="mx-auto mt-6 max-w-2xl scroll-mt-32 animate-fade-in">
                  {findLoading ? (
                    <div className="space-y-3">
                      <div className="h-24 animate-pulse rounded-2xl bg-zinc-800/50" />
                      <div className="h-16 animate-pulse rounded-xl bg-zinc-800/30" />
                    </div>
                  ) : findResults.length === 0 ? (
                    /* ── No results — fallback or promoted external ── */
                    <div className="space-y-3">
                      {/* Best Option card — promote top external result if available */}
                      <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.06] to-zinc-950 p-5">
                        <div className="mb-3 flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Best option for &ldquo;{stripFindPrefixes(heroIdea)}&rdquo;{findCity ? ` in ${findCity}` : ""}</span>
                        </div>

                        {findExternalResults.length > 0 ? (() => {
                          const top = findExternalResults[0];
                          return (
                            <>
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-lg font-bold text-white">{top.name}</div>
                                  {top.address && <div className="mt-0.5 text-[12px] text-zinc-400">{top.address}</div>}
                                </div>
                                {top.rating != null && (
                                  <div className="shrink-0 text-right">
                                    <div className="text-lg font-bold text-amber-400">{top.rating.toFixed(1)}</div>
                                    {top.review_count > 0 && <div className="text-[9px] text-zinc-500">{top.review_count} reviews</div>}
                                  </div>
                                )}
                              </div>
                              <p className="mt-2 text-[12px] text-zinc-500">
                                {proofRewardsEnabled
                                  ? "Highly rated nearby. Earn 10 DUM Points when you verify your purchase."
                                  : "Highly rated nearby. Visit and help bring them to DUM Club."}
                              </p>
                              <div className="mt-3 flex gap-2">
                                {proofRewardsEnabled && top.id ? (
                                  <button
                                    type="button"
                                    onClick={() => { if (!user) { login(); return; } setProofModalBiz({ id: top.id, name: top.name }); }}
                                    className="flex-1 rounded-xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_20px_rgba(0,255,163,0.2)]"
                                  >
                                    I bought here →
                                  </button>
                                ) : (
                                  <a
                                    href={`https://www.google.com/maps/search/${encodeURIComponent(top.name + (top.address ? " " + top.address : ""))}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="flex-1 rounded-xl bg-emerald-400 px-5 py-3.5 text-center text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_20px_rgba(0,255,163,0.2)]"
                                  >
                                    View on map →
                                  </a>
                                )}
                              </div>
                            </>
                          );
                        })() : (
                          <>
                            <div className="text-lg font-bold text-white">
                              {findCity
                                ? `Local ${stripFindPrefixes(heroIdea)} options in ${findCity}`
                                : `${stripFindPrefixes(heroIdea).replace(/^./, (c) => c.toUpperCase())} near you`}
                            </div>
                            <p className="mt-1 text-[12px] text-zinc-500">
                              This isn&apos;t on DUM Club yet — but you can still find a local option fast.
                            </p>
                            <a
                              href={`https://www.google.com/maps/search/${encodeURIComponent(stripFindPrefixes(heroIdea) + (findCity ? ` in ${findCity}` : " near me"))}`}
                              target="_blank" rel="noopener noreferrer"
                              className="mt-4 flex w-full items-center justify-center rounded-xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_20px_rgba(0,255,163,0.2)]"
                            >
                              Find nearby →
                            </a>
                          </>
                        )}
                      </div>

                      {/* Supporting actions */}
                      <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 mb-2">Bring it to DUM Club</div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={() => { stopSpeaking(); setHeroIdea(findQueryToCreatePrompt(heroIdea, findCity)); setFindResults(null); setFindTopOffer(null); setFindExplanation(""); setFindAiExplanation(""); setFindAckLine(""); setRefineHistory([]); findExplainGenRef.current++; setFindAllOffers([]); setFindAltOffers({}); setFindExternalResults([]); }}
                            className="flex-1 rounded-xl bg-zinc-800 px-4 py-2.5 text-[12px] font-semibold text-white transition hover:bg-zinc-700"
                          >
                            Create this business →
                          </button>
                          {!findSuggestSent ? (
                            <button
                              type="button"
                              onClick={() => {
                                const s = JSON.parse(localStorage.getItem("dum_suggestions") || "[]");
                                s.push({ name: heroIdea, query: heroIdea, city: findCity, ts: Date.now() });
                                localStorage.setItem("dum_suggestions", JSON.stringify(s.slice(-50)));
                                setFindSuggestSent(true);
                              }}
                              className="flex-1 rounded-xl border border-zinc-800 px-4 py-2.5 text-[12px] text-zinc-400 transition hover:border-emerald-400/30 hover:text-emerald-400"
                            >
                              Suggest it
                            </button>
                          ) : (
                            <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-2.5 text-[12px] text-emerald-400">
                              ✓ Noted
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between pt-1">
                        <Link href={`/discover?q=${encodeURIComponent(heroIdea)}`} className="text-[11px] text-zinc-600 transition hover:text-zinc-400">
                          Browse the marketplace →
                        </Link>
                        <button type="button" onClick={() => { stopSpeaking(); setFindResults(null); setFindCity(""); setFindTopOffer(null); setFindExplanation(""); setFindAiExplanation(""); setFindAckLine(""); setRefineHistory([]); setShowAlternatives(false); findExplainGenRef.current++; setFindAllOffers([]); setFindAltOffers({}); setFindExternalResults([]); setFindRefineInput(""); }} className="text-[11px] text-zinc-600 transition hover:text-zinc-400">
                          ✕ Clear
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Results found ── */
                    <div className="space-y-3">
                      {/* Section label: on DUM Club */}
                      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-400/70">On DUM Club</div>
                      {/* ── Best Option card ── */}
                      {(() => {
                        const top = findResults[0];
                        return (
                          <div className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.06] to-zinc-950 p-5">
                            <div className="mb-3 flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Best option for &ldquo;{stripFindPrefixes(heroIdea)}&rdquo;{findCity ? ` in ${findCity}` : ""}</span>
                            </div>

                            {findTopOffer ? (
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-lg font-bold text-white">{findTopOffer.title}</div>
                                  <div className="mt-0.5 text-[12px] text-zinc-400">from <Link href={`/project/${top.id}`} className="text-zinc-300 underline decoration-dotted underline-offset-2 transition hover:text-emerald-400">{top.title || top.name}</Link></div>
                                </div>
                                <div className="font-mono text-2xl font-bold text-emerald-400">${findTopOffer.price < 1 ? findTopOffer.price.toFixed(2) : Math.round(findTopOffer.price)}</div>
                              </div>
                            ) : (
                              <div>
                                <Link href={`/project/${top.id}`} className="group">
                                  <div className="text-lg font-bold text-white transition group-hover:text-emerald-400">{top.title || top.name}</div>
                                </Link>
                                <div className="mt-0.5 text-[12px] text-zinc-500">Loading offers...</div>
                              </div>
                            )}

                            {/* AI explanation inline */}
                            {findExplanation && (
                              <div className="mt-3 flex gap-2">
                                <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400/10 text-[7px] font-bold text-emerald-400">{findAiExplanation ? "✦" : "◆"}</div>
                                <div className="flex-1">
                                  {findAckLine && <p className="text-[11px] font-medium text-zinc-300 mb-0.5">{findAckLine}</p>}
                                  <p className={`text-[12px] leading-relaxed text-zinc-500 transition-opacity duration-150 ${findAiFading ? "opacity-0" : "opacity-100"}`}>{findAiExplanation || findExplanation}</p>
                                </div>
                                {canSpeak() && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (voiceMuted) {
                                        setVoiceMuted(false);
                                        speakText(findAiExplanation || findExplanation);
                                      } else {
                                        setVoiceMuted(true);
                                        stopSpeaking();
                                      }
                                    }}
                                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition ${voiceMuted ? "text-zinc-600 hover:text-zinc-400" : "text-emerald-400/60 hover:text-emerald-400"}`}
                                    title={voiceMuted ? "Unmute voice" : "Mute voice"}
                                  >
                                    {voiceMuted ? (
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                                    ) : (
                                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                                    )}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Primary CTA */}
                            <Link
                              href={`/project/${top.id}${findTopOffer ? `?offer=${encodeURIComponent(findTopOffer.title)}&reason=${findTopOffer.reason}` : ""}`}
                              className="mt-4 flex w-full items-center justify-center rounded-xl bg-emerald-400 px-5 py-3.5 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_20px_rgba(0,255,163,0.2)]"
                            >
                              {findTopOffer ? "Get this →" : "View offers →"}
                            </Link>

                            {/* Secondary: see other options */}
                            {(findAllOffers.length > 1 || findResults.length > 1) && (
                              <button
                                type="button"
                                onClick={() => setShowAlternatives((v) => !v)}
                                className="mt-2 flex w-full items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-300"
                              >
                                {showAlternatives ? "Hide other options" : `See other options (${Math.max(findAllOffers.length - 1, findResults.length - 1)})`}
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className={`transition-transform ${showAlternatives ? "rotate-180" : ""}`}>
                                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </button>
                            )}
                          </div>
                        );
                      })()}

                      {/* ── Refinement input (always visible) ── */}
                      {findResults.length > 0 && findAllOffers.length > 1 && (
                        <div className="flex gap-2">
                          <input
                            ref={refineInputRef}
                            value={findRefineInput}
                            onChange={(e) => setFindRefineInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || !findRefineInput.trim()) return;
                              stopSpeaking();
                              const q = findRefineInput.toLowerCase().trim();
                              const prevOffer = findTopOffer ? { title: findTopOffer.title, price: findTopOffer.price } : null;
                              let newPick: typeof findAllOffers[0] | null = null;
                              let newLabel = "";
                              let newExplanation = "";
                              let newReason = "";

                              if (q.includes("cheap") || q.includes("less") || q.includes("afford") || q.includes("budget")) {
                                const cheapest = findAllOffers[0];
                                newPick = cheapest;
                                newLabel = "Cheapest option";
                                newReason = "cheapest";
                                newExplanation = `${cheapest.title} at $${Math.round(cheapest.price)} is the most affordable option.`;
                              } else if (q.includes("popular") || q.includes("most ordered") || q.includes("favorite")) {
                                const bestSeller = [...findAllOffers].sort((a, b) => b.sold - a.sold)[0];
                                newPick = bestSeller;
                                const hasSalesData = bestSeller.sold > 0;
                                newLabel = hasSalesData ? "Most popular" : "Recommended";
                                newReason = "popular";
                                newExplanation = bestSeller.sold > 0
                                  ? `${bestSeller.title} at $${Math.round(bestSeller.price)} is the most popular choice with ${bestSeller.sold} sold.`
                                  : `${bestSeller.title} at $${Math.round(bestSeller.price)} is a top option to consider.`;
                              } else if (q.includes("pick") || q.includes("which") || q.includes("suggest") || q.includes("recommend")) {
                                const mid = findAllOffers[Math.floor(findAllOffers.length / 2)];
                                newPick = mid;
                                newLabel = "Our pick";
                                newReason = "pick";
                                newExplanation = `${mid.title} at $${Math.round(mid.price)} is a solid middle-ground option.`;
                              } else if (q.includes("better") || q.includes("premium") || q.includes("best") || q.includes("top") || q.includes("more")) {
                                const premium = findAllOffers[findAllOffers.length - 1];
                                newPick = premium;
                                newLabel = "Premium option";
                                newReason = "premium";
                                newExplanation = `${premium.title} at $${Math.round(premium.price)} is the most comprehensive option available.`;
                              } else if (q.match(/under\s*\$?\d+|\$\d+|below\s*\d+/)) {
                                const priceMatch = q.match(/\d+/);
                                if (priceMatch) {
                                  const maxPrice = Number(priceMatch[0]);
                                  const under = findAllOffers.filter((o) => o.price <= maxPrice);
                                  if (under.length > 0) {
                                    newPick = under[under.length - 1];
                                    newLabel = `Under $${maxPrice}`;
                                    newReason = "cheapest";
                                    newExplanation = `${newPick.title} at $${Math.round(newPick.price)} fits within your budget.`;
                                  } else {
                                    newExplanation = `Nothing under $${maxPrice}. The most affordable option is ${findAllOffers[0].title} at $${Math.round(findAllOffers[0].price)}.`;
                                  }
                                }
                              } else {
                                const currentIdx = findTopOffer ? findAllOffers.findIndex((o) => o.title === findTopOffer.title) : -1;
                                const nextIdx = (currentIdx + 1) % findAllOffers.length;
                                newPick = findAllOffers[nextIdx];
                                newLabel = "Another option";
                                newReason = "next";
                                newExplanation = `${newPick.title} at $${Math.round(newPick.price)} is another option to consider.`;
                              }

                              // Build multi-turn acknowledgment line
                              const same = newPick && prevOffer && newPick.title === prevOffer.title;
                              const lastReason = refineHistory.length > 0 ? refineHistory[refineHistory.length - 1].reason : "";
                              const stepCount = refineHistory.length;
                              let ack = "";

                              // Direction-aware acknowledgments
                              if (newReason === "cheapest") {
                                if (same) {
                                  ack = "You\u2019re already looking at the most affordable option.";
                                } else if (lastReason === "premium") {
                                  ack = "Switching back to a more affordable option.";
                                } else {
                                  ack = "Switching to the lowest-priced option.";
                                }
                              } else if (newReason === "premium") {
                                if (same) {
                                  ack = "You\u2019re already looking at the top-tier option.";
                                } else if (lastReason === "cheapest") {
                                  ack = "Upgrading from the lowest-priced option.";
                                } else {
                                  ack = "Switching to the premium option.";
                                }
                              } else if (newReason === "popular") {
                                const hasSales = findAllOffers.some((o) => o.sold > 0);
                                if (same) {
                                  ack = hasSales ? "This is already the most popular choice." : "This is already a top option here.";
                                } else {
                                  ack = hasSales ? "Here\u2019s the most popular choice right now." : "Here\u2019s a top option to consider.";
                                }
                              } else if (newReason === "pick") {
                                if (same) {
                                  ack = "This is already our best balanced pick.";
                                } else if (stepCount >= 2) {
                                  ack = "You\u2019ve seen a few options \u2014 this is the best middle ground.";
                                } else {
                                  ack = "This is our best balanced pick.";
                                }
                              } else if (newLabel.startsWith("Under")) {
                                ack = newPick ? "This option fits under your budget." : "";
                              } else if (newReason === "next") {
                                ack = stepCount >= 2 ? "Here\u2019s another option to compare." : "Here\u2019s another option.";
                              }
                              if (!newPick && newExplanation.startsWith("Nothing under")) {
                                ack = "Nothing in that range \u2014 here\u2019s the closest.";
                              }

                              // Update state
                              if (newPick) {
                                setFindTopOffer({ title: newPick.title, price: newPick.price, label: newLabel, reason: newReason });
                              }
                              if (newExplanation) setFindExplanation(newExplanation);
                              setFindAiExplanation("");
                              setFindAckLine(ack);
                              setRefineHistory((h) => [...h, { reason: newReason, offerTitle: newPick?.title || "" }].slice(-4));

                              // Async AI explanation for the refinement
                              const refinementQuery = findRefineInput.trim();
                              setFindRefineInput("");
                              if (newPick && findResults && findResults.length > 0) {
                                const gen = ++findExplainGenRef.current;
                                const top = findResults[0];
                                fetch(`${API_BASE}/api/ai/homepage-explain`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    query: heroIdea,
                                    city: findCity,
                                    matched_project: {
                                      id: top.id,
                                      title: top.title || top.name || "",
                                      description: top.description || "",
                                      category: top.template_type || "",
                                    },
                                    offers: findAllOffers.map((o) => ({ title: o.title, price: o.price, sold: o.sold })),
                                    highlighted_offer: { title: newPick.title, price: newPick.price, label: newLabel, reason: newReason },
                                    alternative_title: findResults.length > 1 ? (findResults[1].title || findResults[1].name || "") : "",
                                    refinement: refinementQuery,
                                    previous_offer: prevOffer,
                                    refinement_history: refineHistory.slice(-3).map((h) => h.reason),
                                  }),
                                })
                                  .then((r) => r.ok ? r.json() : null)
                                  .then((data) => {
                                    if (data?.explanation && findExplainGenRef.current === gen) {
                                      setFindAiFading(true);
                                      setTimeout(() => {
                                        setFindAiExplanation(data.explanation);
                                        setFindAiFading(false);
                                        if (voiceInitiatedRef.current && !voiceMuted) speakText(data.explanation);
                                      }, 150);
                                    } else if (voiceInitiatedRef.current && !voiceMuted && findExplainGenRef.current === gen) {
                                      speakText(newExplanation);
                                    }
                                  })
                                  .catch(() => { if (voiceInitiatedRef.current && !voiceMuted) speakText(newExplanation); });
                              }
                            }}
                            placeholder="Anything cheaper, better, or different?"
                            className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-[12px] text-white placeholder-zinc-600 outline-none transition focus:border-zinc-600"
                          />
                          <button
                            type="button"
                            onClick={() => refineInputRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))}
                            disabled={!findRefineInput.trim()}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/30 text-zinc-600 transition hover:border-emerald-400/30 hover:text-emerald-400 disabled:opacity-30 disabled:pointer-events-none"
                            title="Submit"
                          >
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 1l7 7-7 7"/></svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof window === "undefined") return;
                              const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                              if (!SR) return;
                              const rec = new SR();
                              rec.lang = "en-US";
                              rec.interimResults = false;
                              rec.maxAlternatives = 1;
                              rec.onstart = () => setRefineListening(true);
                              rec.onresult = (ev: any) => {
                                setFindRefineInput(ev.results[0][0].transcript);
                                voiceInitiatedRef.current = true;
                                setRefineListening(false);
                              };
                              rec.onerror = () => setRefineListening(false);
                              rec.onend = () => setRefineListening(false);
                              rec.start();
                            }}
                            disabled={refineListening}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition ${
                              refineListening
                                ? "border-red-400/40 bg-red-400/10 text-red-400 animate-pulse"
                                : "border-zinc-800 bg-zinc-900/30 text-zinc-600 hover:border-emerald-400/30 hover:text-emerald-400"
                            }`}
                            title={refineListening ? "Listening..." : "Voice input"}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                              <line x1="12" y1="19" x2="12" y2="23" />
                              <line x1="8" y1="23" x2="16" y2="23" />
                            </svg>
                          </button>
                        </div>
                      )}

                      {/* ── Alternatives (collapsed by default) ── */}
                      {showAlternatives && (
                        <div className="space-y-2 animate-fade-in">
                          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600 pt-1">Other options</div>

                          {/* Other offers from the same business */}
                          {findAllOffers.filter((o) => !findTopOffer || o.title !== findTopOffer.title).map((o) => (
                            <Link
                              key={o.title}
                              href={`/project/${findResults[0].id}`}
                              className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-2.5 transition hover:border-zinc-700"
                            >
                              <div>
                                <div className="text-[13px] font-semibold text-zinc-300 transition group-hover:text-emerald-400">{o.title}</div>
                                <div className="mt-0.5 text-[10px] text-zinc-600">{findResults[0].title || findResults[0].name}</div>
                              </div>
                              <div className="font-mono text-sm font-bold text-zinc-400 transition group-hover:text-emerald-400">${o.price < 1 ? o.price.toFixed(2) : Math.round(o.price)}</div>
                            </Link>
                          ))}

                          {/* Alternative businesses */}
                          {findResults.slice(1).map((alt) => {
                            const altOffer = findAltOffers[alt.id];
                            return (
                              <Link key={alt.id} href={`/project/${alt.id}`} className="group flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-2.5 transition hover:border-zinc-700">
                                <div>
                                  <div className="text-[13px] font-semibold text-zinc-300 transition group-hover:text-emerald-400">{altOffer ? altOffer.title : (alt.title || alt.name)}</div>
                                  <div className="mt-0.5 text-[10px] text-zinc-600">{altOffer ? `from ${alt.title || alt.name}` : "Another matching business"}</div>
                                </div>
                                {altOffer ? (
                                  <div className="font-mono text-sm font-bold text-zinc-400 transition group-hover:text-emerald-400">${altOffer.price < 1 ? altOffer.price.toFixed(2) : Math.round(altOffer.price)}</div>
                                ) : (
                                  <span className="text-xs text-zinc-500 transition group-hover:text-emerald-400">View →</span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}

                      {/* Footer links */}
                      <div className="flex items-center justify-between pt-1">
                        <Link href={`/discover?q=${encodeURIComponent(heroIdea)}`} className="text-[11px] text-zinc-600 transition hover:text-zinc-400">
                          See all on Discover →
                        </Link>
                        <button type="button" onClick={() => { stopSpeaking(); setFindResults(null); setFindCity(""); setFindTopOffer(null); setFindExplanation(""); setFindAiExplanation(""); setFindAckLine(""); setRefineHistory([]); setShowAlternatives(false); findExplainGenRef.current++; setFindAllOffers([]); setFindAltOffers({}); setFindExternalResults([]); setFindRefineInput(""); }} className="text-[11px] text-zinc-600 transition hover:text-zinc-400">
                          ✕ Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Nearby outside DUM Club (skip first if promoted to primary card) ── */}
                  {(() => {
                    const extsToShow = (findResults.length === 0 && findExternalResults.length > 1)
                      ? findExternalResults.slice(1)
                      : findExternalResults;
                    return extsToShow.length > 0 && !findLoading && (
                    <div className="mt-4 animate-fade-in">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">Nearby / Not on DUM Club yet</div>
                      <div className="space-y-2">
                        {extsToShow.map((ext, i) => (
                          <div key={`${ext.external_source}-${ext.external_place_id}-${i}`} className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[13px] font-semibold text-zinc-300">{ext.name}</div>
                                {ext.address && <div className="mt-0.5 text-[10px] text-zinc-600 truncate">{ext.address}</div>}
                              </div>
                              {ext.rating != null && (
                                <div className="shrink-0 text-right">
                                  <div className="text-[12px] font-bold text-amber-400">{ext.rating.toFixed(1)}</div>
                                  {ext.review_count > 0 && <div className="text-[9px] text-zinc-600">{ext.review_count} reviews</div>}
                                </div>
                              )}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className="text-[10px] text-zinc-600">
                                {proofRewardsEnabled
                                  ? "Not on DUM Club yet. Submit proof of purchase to earn DUM Points after verification."
                                  : "Not on DUM Club yet. Help bring this business to the platform."}
                              </p>
                              {proofRewardsEnabled && ext.id && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!user) { login(); return; }
                                    setProofModalBiz({ id: ext.id, name: ext.name });
                                  }}
                                  className="shrink-0 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 text-[10px] font-semibold text-emerald-400 transition hover:bg-emerald-400/10"
                                >
                                  I bought here
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })()}
                </div>
              )}

              {/* ── LIVE PREVIEW (hidden when find results showing) ── */}
              {findResults === null && preview && !heroLaunching && (
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
              {!heroLaunching && findResults === null && launchCount > 0 && launchCount < FREE_LAUNCH_LIMIT && (
                <div className="mx-auto mt-3 max-w-2xl text-center">
                  <span className="text-[11px] text-zinc-600">
                    {FREE_LAUNCH_LIMIT - launchCount} free business{FREE_LAUNCH_LIMIT - launchCount === 1 ? "" : "es"} remaining
                  </span>
                </div>
              )}

              {/* ── TEMPLATE STARTERS (hidden when find results showing) ── */}
              {!heroLaunching && findResults === null && (
                <div className="hero-entrance-delay-2 mx-auto mt-6 max-w-2xl">
                  <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                    Try an example
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
                  Stripe checkout · Verified merchants · Live in 60 seconds
                </p>
                {/* Payment icons — consumer-facing payment methods only.
                    Solana removed per Phase 0A and consolidated on /technology. */}
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
                  <span className="text-zinc-600">Apple Pay</span>
                  <span className="text-zinc-800">·</span>
                  <span className="text-zinc-600">Stripe Checkout</span>
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
            Three steps. Live today.
          </h2>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-300 sm:text-lg">
            No developers. No technical knowledge. Just describe what you need.
          </p>
          <div className="mt-12 grid gap-3 pt-10 sm:grid-cols-3">
            {[
              { n: "01", title: "Describe It", desc: "Tell the AI what you sell or what you need — coaching, services, products, anything." },
              { n: "02", title: "We Launch It", desc: "Your storefront and marketplace listing go live automatically. No setup needed." },
              { n: "03", title: "You Earn", desc: "Sell and get paid. Buy and earn rewards. Everyone wins." },
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
                title: "AI-Powered Marketplace",
                desc: "Describe what you sell or what you need. AI builds the storefront and connects it to the marketplace.",
              },
              {
                tag: "Store",
                title: "Buy & Sell Anything",
                desc: "Sell services, products, or access — or find and buy from others. One link. Instant transactions.",
              },
              {
                tag: "Assistant",
                title: "AI Sales Assistant",
                desc: "Every business gets a trained assistant that knows your offers and helps customers buy.",
              },
              {
                tag: "Loyalty",
                title: "Automatic Rewards",
                desc: "Repeat customers earn rewards automatically. No extra work.",
              },
              {
                tag: "Payments",
                title: "Stripe Payments Built In",
                desc: "Customers pay by card. You get paid. No setup, no merchant account.",
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

        {/* ── AI ASSISTANT DEMO ── */}
        <div className="mx-auto mt-16 max-w-3xl px-4">
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/80 p-6 sm:p-8">
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400/60">Built-in AI Assistant</div>
            <h3 className="text-xl font-extrabold text-white sm:text-2xl">Every business comes with a sales assistant.</h3>
            <p className="mt-2 max-w-lg text-sm text-zinc-500">Answers customer questions instantly and helps close the sale. No setup. No training. Ready at launch.</p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {/* Mini storefront preview */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="flex items-center gap-3">
                  <img
                    src="/Julian.jpeg"
                    alt="Julian Mero — founder, Topgun Maintenance LLC"
                    className="h-10 w-10 rounded-full object-cover border border-emerald-400/25"
                  />
                  <div>
                    <div className="text-sm font-bold text-white">Topgun Maintenance LLC</div>
                    <div className="text-[10px] text-zinc-500">Aircraft maintenance · MMU · NY NJ PA CT DE</div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {[
                    { name: "Annual Inspection (FAR 91)", price: "$850" },
                    { name: "100-Hour Inspection", price: "$650" },
                    { name: "AOG Emergency Response", price: "$500" },
                  ].map((offer) => (
                    <div key={offer.name} className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-950/60 px-3 py-2">
                      <span className="text-[12px] text-zinc-300">{offer.name}</span>
                      <span className="font-mono text-[12px] font-bold text-emerald-400">{offer.price}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI conversation preview */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <div className="mb-3 flex items-center gap-2">
                  <img
                    src="/Julian.jpeg"
                    alt="Julian Mero — founder, Topgun Maintenance LLC"
                    className="h-6 w-6 rounded-full object-cover border border-emerald-400/25"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">AI Assistant</span>
                </div>
                <div className="space-y-3">
                  {/* Customer question */}
                  <div className="flex justify-end">
                    <div className="rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[12px] text-zinc-300">
                      What&apos;s included in the annual inspection?
                    </div>
                  </div>
                  {/* AI answer */}
                  <div className="flex gap-2">
                    <img
                      src="/Julian.jpeg"
                      alt="Julian Mero — founder, Topgun Maintenance LLC"
                      className="mt-1 h-5 w-5 shrink-0 rounded-full object-cover border border-emerald-400/25"
                    />
                    <div className="rounded-xl rounded-bl-sm border border-zinc-800/60 bg-zinc-950/80 px-3 py-2 text-[12px] leading-relaxed text-zinc-400">
                      Full FAR Part 91 airworthiness check per 14 CFR 43 Appendix D — logbook signoff, discrepancy report, and return-to-service docs included. Typical turnaround 2–5 days at MMU.
                      <span className="mt-1.5 block text-emerald-400/70">Annual Inspection — $850 →</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
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

        {/* Bottom CTA */}
        <div id="section-cta" className="border-t border-zinc-900 px-4 py-20 text-center sm:py-28">
          <div className="mx-auto max-w-2xl">
            <div className="mb-5 text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
              Ready?
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
              Your next move.
              <br />
              <span className="text-emerald-400">Live today.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-zinc-300">
              Sell something new, find what you need, or earn rewards along the way. AI builds the storefront and connects it to the marketplace.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                href="/build"
                className="rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300 hover:shadow-[0_0_24px_rgba(0,255,163,0.25)]"
              >
                Get Started Free →
              </Link>
              <Link
                href="/discover"
                className="rounded-xl border border-zinc-700 px-8 py-4 text-sm text-zinc-300 transition hover:border-zinc-500 hover:text-white"
              >
                Browse the Marketplace
              </Link>
            </div>
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-emerald-400/10 bg-emerald-400/[0.03] px-5 py-3 text-center text-[12px] text-zinc-400">
              <span className="text-emerald-400">◆</span> Every purchase earns DUM Points — redeemable at <strong className="text-zinc-300">any</strong> business on the platform.
            </div>
          </div>
        </div>
      </section>

      {/* Honest stack strip — payment + infra brands only.
          Solana removed per Phase 0A and consolidated on /technology. */}
      <div className="border-t border-zinc-900 py-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-5 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-600">
            Built with
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-3">
            {["Stripe", "Supabase", "Next.js", "Vercel"].map((name) => (
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
                Local Commerce, Real Rewards
              </p>
              <p className="max-w-xs text-sm leading-relaxed text-zinc-400">
                Book local home and auto services in Morris County. Stripe payments, verified merchants, and rewards that work at every shop on the network.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                  <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="font-mono text-[10px] text-emerald-500">
                  EARLY ACCESS · DOVER, NJ
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
                    href: "mailto:julian@dum.club",
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
                  { label: "Technology", href: "/technology" },
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
              DUM Club operates in early access. Content on this platform is for
              informational purposes only and does not constitute financial, legal, or
              investment advice. DUM Points are a loyalty unit redeemable for discounts at
              participating merchants — not an investment, with no secondary market and no
              expectation of price appreciation. For technical details on how the platform
              is built, see the{" "}
              <Link href="/technology" className="text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline">
                Technology page
              </Link>
              .
            </p>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <img src="/dum-logo-icon.png" alt="DUM Club" className="h-5 w-auto opacity-80" />
                <span className="text-[12px] font-bold tracking-tight">
                  <span className="text-zinc-300">DUM </span><span style={{ color: "#00FFA3" }}>CLUB</span>
                </span>
                <span className="text-[10px] text-zinc-700">© {new Date().getFullYear()} · All rights reserved</span>
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

      {/* Proof of purchase modal for off-platform businesses */}
      {proofModalBiz && (
        <ProofOfPurchaseModal
          businessId={proofModalBiz.id}
          businessName={proofModalBiz.name}
          buyerPrivyId={user?.privyId || ""}
          onClose={() => setProofModalBiz(null)}
          onSubmitted={() => setProofModalBiz(null)}
        />
      )}
    </div>
  );
}
