"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UtensilsCrossed,
  Wrench,
  HardHat,
  Dumbbell,
  ShoppingBag,
  PartyPopper,
  Sparkles,
  Diamond,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { ScrollReveal } from "../components/motion/ScrollReveal";
// ListingGrid powers the homepage marketplace rail — same component
// /discover renders. Reused verbatim: gives the homepage the
// image+category+price card layout without duplicating any rendering
// logic. ListingCard inside is wallet-clean (no @solana/* imports
// reachable), so this stays out of the lazy-Solana-subtree chunk
// added by #351.
import { ListingGrid } from "../components/discover/ListingGrid";
// LiveRail powers the homepage Live Now rail — same component the
// /discover page renders, so live cards look and link identically
// on both surfaces (/project/{slug}?live=1, cap 12 + overflow).
import { LiveRail } from "../components/discover/LiveRail";

// Below-the-fold components — code-split out of the initial homepage
// bundle so the hero text (the LCP element on mobile) can paint without
// waiting on their JS. All four either render below the fold
// (LoomExplainer, ProofOfMotion, FounderNote) or are hidden until
// triggered (ProofOfPurchaseModal). ssr:false because none of them are
// part of the initial paint we care about for SEO.
const ProofOfPurchaseModal = dynamic(
  () => import("../components/ProofOfPurchaseModal").then((m) => ({ default: m.ProofOfPurchaseModal })),
  { ssr: false, loading: () => null },
);
const ProofOfMotion = dynamic(
  () => import("../components/ProofOfMotion").then((m) => ({ default: m.ProofOfMotion })),
  { ssr: false, loading: () => null },
);
const FounderNote = dynamic(
  () => import("../components/FounderNote").then((m) => ({ default: m.FounderNote })),
  { ssr: false, loading: () => null },
);
const LoomExplainer = dynamic(
  () => import("../components/LoomExplainer").then((m) => ({ default: m.LoomExplainer })),
  { ssr: false, loading: () => null },
);
// FeeCalculator moved to /business page. seller content lives there now.
import { useAuth } from "../lib/auth/AuthContext";
import { speakText, stopSpeaking, canSpeak } from "../lib/speech";

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
import { createClient } from "../lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

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
  { label: "Sell digital goods", prompt: "A business selling online courses, templates, and digital downloads" },
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
      "Sarah typed 'I run an 8-week body transformation program for women.' The AI created her page, pricing tiers, and booking flow. She posted the link to her Instagram story. 22 people signed up before the weekend.",
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
      "Alex uploaded his Figma templates and let the AI write the product descriptions. Within 24 hours he had 12 sales, without building a website or setting up Stripe manually.",
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
      "Dani dropped a link to his beat pack. The AI wrote the copy, set three pricing tiers, and the page went live. 200 downloads on the first day. No distributor, no middleman.",
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
      <div className="relative w-full max-w-md animate-fade-in rounded-2xl border border-default bg-surface-card p-8 shadow-2xl shadow-black/60">
        {/* Top accent line */}
        <div className="absolute left-[20%] right-[20%] top-0 h-px bg-gradient-to-r from-transparent via-brand-teal to-transparent" />

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-default bg-surface-card text-xs text-secondary transition hover:bg-surface-muted hover:text-primary"
        >
          ✕
        </button>

        {/* Label */}
        <div className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
          <span className="inline-block h-px w-4 bg-brand-teal" />
          Example Scenario
        </div>

        {/* Avatar + name */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-violet-500 text-xl">
            {story.emoji}
          </div>
          <div>
            <div className="text-[15px] font-bold text-primary">{story.name}</div>
            <div className="text-[12px] text-secondary">{story.project}</div>
          </div>
        </div>

        {/* Quote */}
        <div className="mb-3 border-l-2 border-default pl-3 text-[14px] italic leading-relaxed text-secondary">
          &ldquo;{story.detail}&rdquo;
        </div>

        {/* Result stat */}
        <div className="mb-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-default bg-surface-card p-3 text-center">
            <div className="text-xl font-extrabold text-brand-teal">
              {story.stat.value}
            </div>
            <div className="mt-1 text-[10px] text-secondary">
              {story.stat.label}
            </div>
          </div>
          <div className="rounded-xl border border-default bg-surface-card p-3 text-center">
            <div className="text-xl font-extrabold text-primary">AI</div>
            <div className="mt-1 text-[10px] text-secondary">Built by</div>
          </div>
          <div className="rounded-xl border border-default bg-surface-card p-3 text-center">
            <div className="text-xl font-extrabold text-primary">$0</div>
            <div className="mt-1 text-[10px] text-secondary">Setup cost</div>
          </div>
        </div>

        {/* What they sold */}
        <div className="mb-5 rounded-lg border border-default bg-surface-muted px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-secondary">
            What they sell
          </div>
          <div className="mt-1 text-[14px] text-primary">{story.sold}</div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-default pt-4">
          <span className="text-[11px] text-secondary">
            No developer needed
          </span>
          <Link
            href="/merchant"
            className="rounded-lg bg-brand-teal px-4 py-2 text-[12px] font-bold text-black transition hover:bg-brand-teal-hover"
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
      className="flex shrink-0 items-center gap-2.5 rounded-full border border-default bg-surface-card px-4 py-2 text-[13px] text-secondary transition hover:border-default hover:bg-brand-teal-soft hover:text-primary hover:"
    >
      <span className="text-base">{story.emoji}</span>
      <span className="font-medium">{story.name}</span>
      <span className="text-secondary">·</span>
      <span className="text-brand-teal">{story.tag}</span>
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
    <span key={key} className="flex shrink-0 items-center gap-3 font-mono text-xs text-secondary">
      <span className="text-brand-teal">↑</span>
      <span className="font-bold text-brand-teal">DUM</span>
      <span className="text-muted">·</span>
      <span>Activity rising</span>
      <span className="text-muted">·</span>
      {projectCount > 0 ? (
        <span><span className="text-secondary">{projectCount}</span> businesses live</span>
      ) : (
        <span>Businesses launching now</span>
      )}
      <span className="text-muted">·</span>
      {tradeCount > 0 ? (
        <span><span className="text-secondary">{tradeCount}</span> sales on DUM Club</span>
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
      <div className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-secondary">
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
                  ? "border-default bg-brand-teal-soft"
                  : "border-default/40 bg-surface-card"
              }`}
            >
              <div className="flex items-center gap-3">
                {isActive && (
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
                  </span>
                )}
                <div>
                  <span className="text-[13px] font-semibold text-primary">{sale.business_name || "Business"}</span>
                  <span className="mx-2 text-muted">·</span>
                  <span className="text-[12px] text-secondary">{sale.offer_title}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[13px] font-bold text-brand-teal">+${sale.amount?.toFixed(2)}</span>
                <span className="text-[10px] text-secondary">{ago}</span>
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
  { icon: "✓", text: "Offer fulfilled. Seller paid out." },
];

function PlatformActivity({ projectCount }: { projectCount: number }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % ACTIVITY_MESSAGES.length), 3000);
    return () => clearInterval(t);
  }, []);

  const msg = ACTIVITY_MESSAGES[idx];

  return (
    <div className="flex items-center justify-center gap-3 rounded-full border border-default/40 bg-surface-card px-5 py-2.5 backdrop-blur-sm">
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-brand-teal opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
      </span>
      <span key={idx} className="animate-fade-in text-[12px] text-secondary">
        <span className="mr-1.5">{msg.icon}</span>
        {msg.text}
      </span>
      {projectCount > 0 && (
        <span className="ml-2 text-[10px] text-secondary">
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
      { title: "Starter Plan", price: "$19/mo" },
      { title: "Pro Plan", price: "$35/mo" },
      { title: "Enterprise Access", price: "$149/mo" },
    ];
  } else if (isCreator) {
    emoji = "🎨";
    tag = "Creator Business";
    offers = [
      { title: "Single Download", price: "$5" },
      { title: "Complete Bundle", price: "$35" },
      { title: "Monthly Membership", price: "$15/mo" },
    ];
  } else if (isService) {
    emoji = "⚡";
    tag = "Service Business";
    offers = [
      { title: "Basic Session", price: "$35" },
      { title: "Full Package", price: "$89" },
      { title: "Monthly Plan", price: "$59/mo" },
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
      { title: "Basic", price: "$35" },
      { title: "Professional", price: "$79" },
      { title: "Unlimited", price: "$59/mo" },
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
      <div className="mb-6 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-secondary">
        Watch it happen. idea to revenue
      </div>

      {/* Progress dots */}
      <div className="mx-auto mb-6 flex max-w-xs items-center gap-2 justify-center">
        {["Describe", "Build", "Live", "Revenue"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold transition-all duration-500 ${
              phase >= i ? "bg-brand-teal text-black" : "border border-default text-muted"
            }`}>
              {phase > i ? "✓" : i + 1}
            </div>
            <span className={`text-[9px] font-bold uppercase tracking-widest transition-colors duration-300 ${
              phase >= i ? "text-brand-teal" : "text-muted"
            }`}>{label}</span>
            {i < 3 && <span className={`text-sm transition-colors duration-300 ${phase > i ? "text-brand-teal/40" : "text-zinc-800"}`}>→</span>}
          </div>
        ))}
      </div>

      {/* DUM CLUB AI Window. same chrome as the product */}
      <div className="mx-auto max-w-2xl rounded-2xl border border-default bg-surface-card/90 shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(0,255,163,0.04)] overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-default/80 bg-surface-card px-4 py-2.5">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-state-live/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          <div className="flex-1 text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">
            DUM CLUB AI
          </div>
          <div className="relative flex h-2 w-2">
            <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-brand-teal opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
          </div>
        </div>

        {/* Content area */}
        <div className="px-5 py-5 sm:px-6 sm:py-6" style={{ minHeight: 300 }}>

          {/* ── PHASE 0: Typing ── */}
          {phase === 0 && (
            <div className="hero-chat-msg space-y-3">
              {/* AI greeting */}
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-brand-teal text-[9px] font-extrabold text-black">D</div>
                <div className="max-w-[85%] rounded-bl-xl rounded-br-xl rounded-tr-xl border border-violet-500/15 bg-violet-500/[0.07] px-3 py-2 text-[13px] leading-relaxed text-primary">
                  What do you want to build?
                </div>
              </div>
              {/* User typing */}
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-bl-xl rounded-br-xl rounded-tl-xl border border-default bg-brand-teal-soft px-3 py-2">
                  <div className="text-[13px] leading-relaxed text-emerald-100">
                    {DEMO_IDEA.slice(0, typedLen)}
                    <span className="inline-block w-[2px] h-[16px] bg-brand-teal ml-0.5 animate-pulse align-middle" />
                  </div>
                </div>
              </div>
              {/* Launch button */}
              {typedLen >= DEMO_IDEA.length && (
                <div className="hero-chat-msg flex justify-end">
                  <div className="rounded-xl bg-brand-teal px-5 py-2 text-[12px] font-bold text-black">
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
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-brand-teal text-[9px] font-extrabold text-black">D</div>
                <div className="rounded-bl-xl rounded-br-xl rounded-tr-xl border border-violet-500/15 bg-violet-500/[0.07] px-3 py-2 text-[13px] text-primary">
                  Building your business now...
                </div>
              </div>

              {/* Project name */}
              {buildStep >= 1 && (
                <div className="hero-chat-msg rounded-xl border border-default bg-gradient-to-r from-brand-teal-soft to-transparent p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-default bg-surface-card text-xl shadow-inner">🚗</div>
                    <div>
                      <div className="text-[15px] font-bold text-primary">Sparkle Mobile Wash</div>
                      <div className="text-[10px] text-secondary">AI-generated project</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Offers */}
              {buildStep >= 2 && (
                <div className="hero-chat-msg space-y-1.5">
                  {[
                    { name: "Basic Wash", price: "$35", show: buildStep >= 2 },
                    { name: "Full Detail Package", price: "$89", show: buildStep >= 3 },
                    { name: "Monthly Membership", price: "$59/mo", show: buildStep >= 4 },
                  ].filter(o => o.show).map((offer) => (
                    <div key={offer.name} className="card-premium flex items-center justify-between rounded-lg border border-default/40 bg-gradient-to-r from-zinc-900/40 to-surface-card px-4 py-2.5">
                      <span className="text-[13px] text-primary">{offer.name}</span>
                      <span className="text-[13px] font-bold text-brand-teal">{offer.price}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Status checks */}
              {buildStep >= 5 && (
                <div className="hero-chat-msg flex gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-brand-teal text-[9px] font-extrabold text-black">D</div>
                  <div className="rounded-bl-xl rounded-br-xl rounded-tr-xl border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2 font-mono text-[10px] leading-[1.8] text-secondary">
                    <div className="text-secondary">✓ Storefront created</div>
                    {buildStep >= 6 && <div className="text-secondary">✓ Offers generated</div>}
                    {buildStep >= 6 && <div className="text-brand-teal">✓ Payments ready</div>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PHASE 2: Live Business (mini storefront) ── */}
          {phase === 2 && (
            <div className="hero-chat-msg">
              <div className="rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-muted overflow-hidden">
                {/* Storefront header. looks like a real project page */}
                {liveStep >= 1 && (
                  <div className="hero-chat-msg border-b border-default/30 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-default bg-gradient-to-br from-zinc-900 to-surface-card text-xl shadow-inner">🚗</div>
                        <div>
                          <div className="text-[16px] font-bold text-primary">Sparkle Mobile Wash</div>
                          <div className="text-[11px] text-secondary">dum.club/sparkle-wash</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-full border border-default bg-brand-teal-soft px-2.5 py-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-brand-teal opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-teal" />
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-widest text-brand-teal">Live</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Storefront body */}
                <div className="px-5 py-4">
                  {/* Description */}
                  {liveStep >= 2 && (
                    <div className="hero-chat-msg mb-4">
                      <div className="text-[12px] text-secondary mb-3">Premium mobile car detailing at your doorstep</div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {[
                          { name: "Basic Wash", price: "$35", tag: null },
                          { name: "Full Detail", price: "$89", tag: "Most popular" },
                          { name: "Monthly Plan", price: "$59/mo", tag: "Subscription" },
                        ].map((o) => (
                          <div key={o.name} className={`card-premium rounded-xl border bg-gradient-to-b from-zinc-900/40 to-transparent p-3 text-center ${o.tag === "Most popular" ? "border-default" : "border-default/40"}`}>
                            <div className="text-[11px] text-secondary">{o.name}</div>
                            <div className="mt-1 text-[16px] font-extrabold text-brand-teal">{o.price}</div>
                            {o.tag && <div className={`mt-1 text-[8px] font-bold uppercase tracking-widest ${o.tag === "Most popular" ? "text-brand-teal" : "text-brand-teal/50"}`}>{o.tag}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI assistant helping sell */}
                  {liveStep >= 3 && (
                    <div className="hero-chat-msg mb-3 rounded-xl border border-default/40 bg-surface-muted p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-orange-400/15 text-[8px] font-bold text-orange-400 border border-orange-400/20">SM</div>
                        <div className="flex-1">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-secondary mb-1">AI Sales Assistant</div>
                          <div className="text-[11px] leading-relaxed text-secondary">
                            Most customers go with the Full Detail at $89. it covers interior, exterior, and wax. Great value for the price.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {liveStep >= 4 && (
                    <div className="hero-chat-msg flex items-center justify-between border-t border-default/30 pt-3 mb-3">
                      <div className="flex gap-2">
                        <span className="rounded-lg border border-default bg-surface-card px-3 py-1.5 text-[10px] text-secondary">🔗 Share</span>
                        <span className="rounded-lg border border-default bg-surface-card px-3 py-1.5 text-[10px] text-secondary">💬 Ask AI</span>
                      </div>
                      <span className="rounded-xl bg-brand-teal px-4 py-1.5 text-[11px] font-bold text-black">Buy Now →</span>
                    </div>
                  )}

                  {/* Ready signal */}
                  {liveStep >= 5 && (
                    <div className="hero-chat-msg flex items-center gap-2.5 rounded-xl border border-default bg-brand-teal-soft px-4 py-3">
                      <span className="text-base">🎉</span>
                      <div>
                        <div className="text-[12px] font-semibold text-brand-teal">Ready for customers</div>
                        <div className="text-[9px] text-brand-teal/50">Shareable page · Stripe payments · AI support</div>
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
              <div className="rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-brand-teal">New Sale</span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="text-[14px] font-bold text-primary">Full Detail Package</div>
                    <div className="text-[11px] text-secondary">Sarah M. just purchased</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[22px] font-black text-brand-teal">+$89</div>
                    <div className="text-[9px] text-brand-teal/50">Your revenue</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-default/40 bg-surface-muted p-2 text-center">
                    <div className="font-mono text-[14px] font-bold text-primary">$89</div>
                    <div className="text-[8px] text-secondary">This sale</div>
                  </div>
                  <div className="rounded-lg border border-default/40 bg-surface-muted p-2 text-center">
                    <div className="font-mono text-[14px] font-bold text-brand-teal">+2</div>
                    <div className="text-[8px] text-secondary">DUM Points</div>
                  </div>
                  <div className="rounded-lg border border-default/40 bg-surface-muted p-2 text-center">
                    <div className="font-mono text-[14px] font-bold text-primary">✓</div>
                    <div className="text-[8px] text-secondary">Paid via Stripe</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between border-t border-default/80 bg-surface-card px-4 py-2">
          <span className="font-mono text-[9px] text-muted">
            {phase === 0 ? "Describing..." : phase === 1 ? "Building..." : phase === 2 ? "Live ✓" : "Revenue ✓"}
          </span>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i <= phase ? "w-3 bg-brand-teal" : "w-1.5 bg-surface-muted"
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
  { id: "section-cta", label: "Get Started" },
];

/* ─── Live Sale Toast (real Stripe sales only. no demo data) ─── */
const SALE_TOAST_FLOOR = 1; // minimum real sales before toast appears

interface RealSale {
  item: string;
  price: string;
  time: string;
}

function LiveSaleToast() {
  const [sales, setSales] = useState<RealSale[]>([]);
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Fetch real Stripe-verified sales. same endpoint LiveActivityTicker uses
    fetch(`${API_BASE}/api/checkout/recent-sales?limit=6`)
      .then((r) => (r.ok ? r.json() : { sales: [] }))
      .then((data) => {
        const rows: RealSale[] = (data.sales || []).map(
          (s: { item_name?: string; amount?: number; created_at?: string }) => ({
            item: s.item_name || "Purchase",
            price: `$${((s.amount || 0) / 100).toFixed(2)}`,
            time: s.created_at
              ? `${Math.max(1, Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000))}m ago`
              : "just now",
          })
        );
        if (rows.length >= SALE_TOAST_FLOOR) setSales(rows);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (sales.length === 0) return;
    // Show first toast after 4s, then cycle every 18s
    const initialDelay = setTimeout(() => setVisible(true), 4000);
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % sales.length);
        setVisible(true);
      }, 400);
    }, 18000);
    return () => { clearTimeout(initialDelay); clearInterval(cycle); };
  }, [sales]);

  if (sales.length === 0) return null;
  const sale = sales[idx];

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 hidden transition-all duration-500 lg:block ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3 rounded-xl border border-default bg-surface-card/95 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_12px_rgba(0,255,163,0.06)] backdrop-blur-sm">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-teal-soft text-sm">
          💳
        </div>
        <div>
          <div className="text-[12px] font-semibold text-primary">{sale.item}</div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="font-bold text-brand-teal">{sale.price}</span>
            <span className="text-secondary">·</span>
            <span className="text-secondary">{sale.time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Comparison Table: Whatnot vs Commonsold vs Google Maps vs DUM Club ─── */
function ComparisonTable() {
  const rows = [
    { f: "Fee model", w: "8% + 2.9%", c: "% per sale", g: "Pay for ads", d: "Starting at $39/mo + 1.5%" },
    { f: "Per-sale commission", w: "8%", c: "Varies", g: "none", d: "1.5% only" },
    { f: "Live selling", w: "Yes", c: "Yes", g: "No", d: "Yes" },
    { f: "Local discovery", w: "No", c: "No", g: "Pay to rank", d: "Free + deals" },
    { f: "Loyalty built in", w: "None", c: "Basic", g: "None", d: "Every tier" },
    { f: "Bring customers back", w: "None", c: "None", g: "None", d: "Built in" },
    { f: "AI social media", w: "None", c: "None", g: "None", d: "Pro tier" },
    { f: "White-label loyalty", w: "None", c: "None", g: "None", d: "$499/mo+" },
  ];
  const competitors: { label: string; key: "w" | "c" | "g" }[] = [
    { label: "Whatnot", key: "w" },
    { label: "Commonsold", key: "c" },
    { label: "Google Maps", key: "g" },
  ];
  return (
    <div className="mx-auto mt-10 max-w-4xl">
      {/* Desktop / tablet: full table, horizontally scrollable as a safety
          net on the narrowest tablets. Hidden on phones in favor of the
          stacked cards below. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse font-mono text-[11px]" style={{ minWidth: "600px" }}>
          <thead>
            <tr className="border-b border-default">
              <th className="py-3 pr-4 text-left text-[9px] uppercase tracking-[0.12em] text-secondary"> </th>
              <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-secondary">Whatnot</th>
              <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-secondary">Commonsold</th>
              <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-secondary">Google Maps</th>
              <th className="px-4 py-3 text-center text-[9px] uppercase tracking-[0.14em] text-brand-teal" style={{ background: "rgba(0,255,135,0.04)", borderRadius: "8px 8px 0 0", border: "1px solid rgba(0,255,135,0.12)", borderBottom: "none" }}>DUM Club ★</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-default/40">
                <td className="py-3 pr-4 text-[12px] font-medium text-secondary" style={{ fontFamily: "'DM Sans', sans-serif" }}>{row.f}</td>
                <td className="px-3 py-3 text-center text-secondary">{row.w}</td>
                <td className="px-3 py-3 text-center text-secondary">{row.c}</td>
                <td className="px-3 py-3 text-center text-secondary">{row.g}</td>
                <td className="px-4 py-3 text-center font-semibold text-brand-teal" style={{
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

      {/* Phones: one card per row so nothing overflows. DUM Club is
          highlighted on top, the three competitors listed below. */}
      <div className="space-y-3 sm:hidden">
        {rows.map((row, i) => (
          <div key={i} className="rounded-xl border border-default bg-surface-card p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-secondary" style={{ fontFamily: "'DM Sans', sans-serif" }}>{row.f}</div>
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-brand-teal/20 bg-brand-teal-soft/40 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-teal">DUM Club ★</span>
              <span className="text-right text-[12px] font-semibold text-brand-teal">{row.d}</span>
            </div>
            <dl className="space-y-1 font-mono text-[12px]">
              {competitors.map((comp) => (
                <div key={comp.key} className="flex items-center justify-between gap-3">
                  <dt className="text-muted" style={{ fontFamily: "'DM Sans', sans-serif" }}>{comp.label}</dt>
                  <dd className="text-right text-secondary">{row[comp.key]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Search Results ─── */
type SearchResultCard = {
  id: string;
  name: string;
  product: string;
  price: number;
};

type ExternalTopResult = {
  id: string;
  name: string;
  address: string;
  category: string;
  rating: number | null;
  review_count: number;
  external_source: string;
  external_place_id: string;
};

function SearchResults({
  results,
  externalResults,
}: {
  results: Project[] | null;
  externalResults: ExternalTopResult[];
}) {
  const [cards, setCards] = useState<SearchResultCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (results === null) {
      setCards([]);
      setLoaded(false);
      return;
    }
    if (results.length === 0) {
      setCards([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const out = await Promise.all(
        results.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/api/offers/${p.id}`);
            if (!res.ok) return null;
            const data = await res.json();
            const active = Array.isArray(data)
              ? data.filter((o: { is_active?: boolean }) => o.is_active !== false)
              : [];
            if (!active.length) return null;
            const cheapest = [...active].sort(
              (a: { price_usd?: number }, b: { price_usd?: number }) =>
                Number(a.price_usd || 0) - Number(b.price_usd || 0)
            )[0] as { title?: string; price_usd?: number };
            const price = Number(cheapest?.price_usd || 0);
            if (!price) return null;
            return {
              id: p.id,
              name: p.title || p.name || "Untitled",
              product: String(cheapest?.title || ""),
              price,
            } as SearchResultCard;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setCards(out.filter((c): c is SearchResultCard => c !== null));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [results]);

  // Hidden until the user has actually run a search. Once search runs we may
  // have either DUM Club cards or a Google fallback. both require rendering.
  if (results === null && externalResults.length === 0) return null;

  const hasDumResults = cards.length > 0;
  // External fallback renders ONLY when DUM Club returned nothing. Google is
  // the "there's no one on DUM Club for this yet" safety net. never shown
  // alongside on-platform results.
  const showExternalFallback =
    loaded && !hasDumResults && externalResults.length > 0;

  return (
    <div className="mx-auto mt-10 max-w-3xl sm:mt-12">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-secondary">
          Results
        </h3>
      </div>
      {hasDumResults ? (
        <div className="space-y-3">
          {cards.map((c) => (
            <Link
              key={c.id}
              href={`/project/${c.id}`}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-default/60 bg-surface-card p-5 transition hover:border-default hover:bg-surface-card/80"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-secondary">
                  {c.name}
                </div>
                <div className="mt-1 truncate text-[15px] font-bold text-primary">
                  {c.product}
                </div>
              </div>
              <div className="shrink-0 font-mono text-xl font-extrabold text-brand-teal">
                ${c.price.toLocaleString()}
              </div>
            </Link>
          ))}
        </div>
      ) : showExternalFallback ? (
        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-secondary">
            Top-rated nearby on Google Maps
          </div>
          <div className="space-y-3">
            {externalResults.map((r) => (
              <ExternalTopCard key={r.external_place_id || r.id} data={r} />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-secondary">Not on DUM Club yet.</p>
        </div>
      ) : loaded ? (
        <div className="rounded-2xl border border-default bg-surface-card p-8 text-center">
          <p className="text-sm text-secondary">No results yet</p>
        </div>
      ) : null}
    </div>
  );
}

function ExternalTopCard({ data }: { data: ExternalTopResult }) {
  const rating = typeof data.rating === "number" ? data.rating.toFixed(1) : null;
  const reviews = data.review_count > 0 ? data.review_count.toLocaleString() : null;

  // Google Maps URLs API. free, no API-key billing. Opens Google Maps with
  // driving directions to the business. Using place_id is the precise match;
  // destination text is a fallback label for clients that don't honour place_id.
  // https://developers.google.com/maps/documentation/urls/get-started
  const directionsHref = (() => {
    const params = new URLSearchParams({ api: "1" });
    const destLabel = data.address ? `${data.name}, ${data.address}` : data.name;
    params.set("destination", destLabel);
    if (data.external_place_id) {
      params.set("destination_place_id", data.external_place_id);
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  })();

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-default/60 bg-surface-card p-5">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold text-primary">{data.name}</div>
        {data.address ? (
          <div className="mt-1 truncate text-[12px] text-secondary">{data.address}</div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-secondary">
          {rating ? (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <span aria-hidden>★</span>
              <span className="font-mono">{rating}</span>
            </span>
          ) : null}
          {reviews ? <span className="text-secondary">{reviews} reviews</span> : null}
          {data.category ? <span className="text-secondary">· {data.category}</span> : null}
        </div>
      </div>
      <a
        href={directionsHref}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded-full border border-default bg-brand-teal-soft px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-brand-teal transition hover:border-brand-teal-hover hover:bg-brand-teal-soft"
      >
        Directions
      </a>
    </div>
  );
}

/* ─── Live Now Section ───
   Replaced by /discover's shared LiveRail (homepage-live-rail task).
   The bespoke LiveNowSection fired one /api/offers fetch per live
   project and hid live sellers without a priced offer; LiveRail
   reads prices from the already-loaded rows and shows every live
   seller, omitting the price line when none exists. */

/* ─── Deals Section ─── */
type DealCard = {
  id: string;
  project_id: string;
  business_name: string;
  offer_title: string;
  price: number;
};

function DealsSection({ projects }: { projects: Project[] }) {
  const [cards, setCards] = useState<DealCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!projects.length) {
      setCards([]);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      const perProject = await Promise.all(
        projects.map(async (p) => {
          try {
            const res = await fetch(`${API_BASE}/api/offers/${p.id}`);
            if (!res.ok) return [];
            const data = await res.json();
            if (!Array.isArray(data)) return [];
            const active = data.filter(
              (o: { is_active?: boolean }) => o.is_active !== false
            );
            return active
              .map((o: { id?: string; title?: string; price_usd?: number }) => {
                const price = Number(o.price_usd || 0);
                if (!price || !o.id) return null;
                return {
                  id: String(o.id),
                  project_id: p.id,
                  business_name: p.title || p.name || "Untitled",
                  offer_title: String(o.title || ""),
                  price,
                } as DealCard;
              })
              .filter((c: DealCard | null): c is DealCard => c !== null);
          } catch {
            return [];
          }
        })
      );
      if (cancelled) return;
      const flat = perProject.flat().sort((a, b) => a.price - b.price).slice(0, 12);
      setCards(flat);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  // Real-data gate: hide the section entirely if there are no real
  // active offers with a real price across the visible project set.
  if (!loaded) return null;
  if (cards.length === 0) return null;

  return (
    <div className="mx-auto mt-16 max-w-6xl px-4 sm:mt-20">
      <div className="mb-6 flex items-center gap-3">
        <h2 className="text-xl font-extrabold tracking-tight text-brand-navy sm:text-2xl">
          Deals
        </h2>
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-secondary">
          {cards.length} active
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.id}
            href={`/project/${c.project_id}`}
            className="group rounded-2xl border border-default/60 bg-surface-card p-5 transition hover:border-default hover:bg-surface-card/80"
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-secondary">
              {c.business_name}
            </div>
            <div className="mt-1 line-clamp-2 text-[15px] font-bold text-primary">
              {c.offer_title}
            </div>
            <div className="mt-3 font-mono text-xl font-extrabold text-brand-teal">
              ${c.price.toLocaleString()}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ─── Customer Retention Automation Section ─── */
function RetentionSection() {
  const [month, setMonth] = useState(3);
  // Simulate retention math: $49/mo DUM Club vs $500+/mo direct mail
  const dumCost = 99 * month;
  const mailCost = 750 * month;
  const saved = mailCost - dumCost;
  const retainedCustomers = Math.round(month * 22);
  const repeatRevenue = retainedCustomers * 45;

  return (
    <div className="mx-auto mt-20 max-w-6xl px-4">
      <div className="rounded-2xl border border-default bg-surface-card p-6 sm:p-10">
        <div className="mb-2 text-xs font-bold uppercase tracking-[0.35em] text-brand-teal">Customer Retention</div>
        <h2 className="mb-2 text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl">
          Stop losing customers.{" "}
          <span className="text-brand-teal">Automate repeat business.</span>
        </h2>
        <p className="mb-8 max-w-xl text-sm text-secondary">
          DUM Points bring customers back automatically. Our automatic customer win-back texts send reminders, deal pushes, and expiry alerts, so you never lose a customer to a competitor again.
        </p>

        <div className="grid gap-8 sm:grid-cols-2">
          {/* Left: How it works flow */}
          <div className="space-y-4">
            {[
              { step: "1", title: "Customer buys from you", desc: "They earn DUM Points automatically at checkout. No stamps, no cards.", icon: "💳" },
              { step: "2", title: "AI sends them back", desc: "Automated point reminders and deal pushes via email. Zero effort from you.", icon: "🤖" },
              { step: "3", title: "They discover more businesses", desc: "Points work at ANY business on DUM Club. Customers can find nearby deals across the network, which grows yours.", icon: "🔄" },
              { step: "4", title: "You keep them forever", desc: "The switching cost is high. Points + deals + AI = a loyalty moat no competitor can touch.", icon: "🏆" },
            ].map((s) => (
              <div key={s.step} className="flex gap-4 rounded-xl border border-default/40 bg-surface-muted p-4 transition hover:border-default">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-teal-soft text-lg">{s.icon}</div>
                <div>
                  <div className="text-[13px] font-bold text-primary">{s.title}</div>
                  <div className="mt-0.5 text-[12px] text-secondary">{s.desc}</div>
                </div>
              </div>
            ))}

          </div>

          {/* Right: ROI calculator */}
          <div className="rounded-xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-6">
            <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">Retention ROI Calculator</div>
            <div className="mb-4">
              <label className="mb-2 block text-[11px] font-bold text-secondary">Time period: {month} month{month > 1 ? "s" : ""}</label>
              <input
                type="range"
                min={1}
                max={12}
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full accent-brand-teal"
              />
              <div className="mt-1 flex justify-between text-[9px] text-muted">
                <span>1 mo</span>
                <span>6 mo</span>
                <span>12 mo</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-default bg-surface-card p-3">
                <div>
                  <div className="text-[10px] text-secondary">Direct mail cost</div>
                  <div className="text-[10px] text-secondary">$750/mo avg</div>
                </div>
                <div className="font-mono text-lg font-bold text-state-live">${mailCost.toLocaleString()}</div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft p-3">
                <div>
                  <div className="text-[10px] text-brand-teal">DUM Club Growth tier</div>
                  <div className="text-[10px] text-brand-teal/50">$99/mo flat</div>
                </div>
                <div className="font-mono text-lg font-bold text-brand-teal">${dumCost.toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-default bg-brand-teal-soft p-4 text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest text-brand-teal">You save</div>
              <div className="font-mono text-3xl font-black text-brand-teal">${saved.toLocaleString()}</div>
              <div className="mt-1 text-[11px] text-secondary">
                ~{retainedCustomers} customers retained · ~${repeatRevenue.toLocaleString()} repeat revenue
              </div>
            </div>

            <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-brand-teal py-3 text-center text-[13px] font-bold text-black transition hover:bg-brand-teal-hover">
              Start free for 60 days →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Pricing Tiers Section ─── */
function PricingTiers() {
  const tiers = [
    {
      name: "Starter",
      price: "$39",
      period: "/mo",
      desc: "Everything you need to sell online",
      features: ["Storefront on marketplace", "DUM Points built in", "Basic analytics", "Stripe direct payouts", "Listed on Discover"],
      cta: "Get Started",
      highlight: false,
    },
    {
      name: "Growth",
      price: "$99",
      period: "/mo",
      desc: "Retain customers automatically",
      features: ["Everything in Starter", "Featured placement", "Automatic customer win-back texts", "Google review display", "Best Deals eligibility"],
      cta: "Most Popular",
      highlight: true,
    },
    {
      name: "Pro",
      price: "$299",
      period: "/mo",
      desc: "Full automation + social media",
      features: ["Everything in Growth", "AI social media management", "Homepage featured slot", "Cross-business promos", "Full analytics dashboard"],
      cta: "Go Pro",
      highlight: false,
    },
  ];

  return (
    <div className="mx-auto mt-20 max-w-5xl px-4">
      <div className="mb-2 text-center text-xs font-bold uppercase tracking-[0.35em] text-brand-teal">Pricing</div>
      <h2 className="mb-2 text-center text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl">
        Flat fee. <span className="text-brand-teal">1.5% sales fee. That&apos;s it.</span>
      </h2>
      <p className="mx-auto mb-10 max-w-md text-center text-sm text-secondary">
        Join the first 100 merchants. Get 60 days free and lock in founding pricing for life.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${
              tier.highlight
                ? "border-default bg-gradient-to-b from-brand-teal-soft to-surface-card"
                : "border-default bg-surface-card hover:border-default"
            }`}
          >
            {tier.highlight && (
              <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-teal to-transparent" />
            )}
            <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-secondary">{tier.name}</div>
            <div className="mb-1 flex items-baseline gap-1">
              <span className="text-3xl font-black text-primary">{tier.price}</span>
              <span className="text-sm text-secondary">{tier.period}</span>
            </div>
            <div className="mb-5 text-[12px] text-secondary">{tier.desc}</div>
            <div className="mb-5 space-y-2">
              {tier.features.map((f) => (
                <div key={f} className="flex items-center gap-2 text-[12px] text-primary">
                  <span className="text-brand-teal">✓</span>
                  {f}
                </div>
              ))}
            </div>
            <Link
              href="/merchant"
              className={`block w-full rounded-xl py-2.5 text-center text-[12px] font-bold transition ${
                tier.highlight
                  ? "bg-brand-teal text-black hover:bg-brand-teal-hover"
                  : "border border-default text-primary hover:border-strong hover:text-primary"
              }`}
            >
              {tier.cta} →
            </Link>
          </div>
        ))}
      </div>

      <div className="mt-6 text-center text-[11px] text-secondary">
        Need white-label loyalty? <Link href="/business" className="font-bold text-brand-teal hover:text-brand-teal">Business tier from $499/mo →</Link>
      </div>
    </div>
  );
}

/* ─── Whatnot Seller Pitch Section ─── */
function WhatnotPitch() {
  return (
    <div className="mx-auto mt-20 max-w-5xl px-4">
      <div className="overflow-hidden rounded-2xl border border-[var(--state-live)]/30 bg-gradient-to-br from-red-500/[0.04] to-surface-card">
        <div className="grid gap-0 sm:grid-cols-2">
          {/* Left: The problem */}
          <div className="border-b border-default/40 p-8 sm:border-b-0 sm:border-r">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-state-live">The Whatnot tax</div>
            <h3 className="mb-4 text-xl font-extrabold text-brand-navy sm:text-2xl">
              You sell $10,000/mo on Whatnot.
              <br />
              <span className="text-state-live">They keep $1,150.</span>
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-state-live/[0.04] px-4 py-2">
                <span className="text-[12px] text-secondary">Platform fee (8%)</span>
                <span className="font-mono text-[13px] font-bold text-state-live">−$800</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-state-live/[0.04] px-4 py-2">
                <span className="text-[12px] text-secondary">Processing (2.9% + $0.30)</span>
                <span className="font-mono text-[13px] font-bold text-state-live">−$350</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-default/40 bg-surface-muted px-4 py-2">
                <span className="text-[12px] font-bold text-primary">You keep</span>
                <span className="font-mono text-[14px] font-bold text-primary">$8,850</span>
              </div>
            </div>
          </div>

          {/* Right: The solution */}
          <div className="p-8">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">The DUM Club way</div>
            <h3 className="mb-4 text-xl font-extrabold text-brand-navy sm:text-2xl">
              Same $10,000/mo.
              <br />
              <span className="text-brand-teal">You keep $9,901.</span>
            </h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft px-4 py-2">
                <span className="text-[12px] text-secondary">Flat monthly fee</span>
                <span className="font-mono text-[13px] font-bold text-brand-teal">−$99</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-default/40 bg-surface-muted px-4 py-2">
                <span className="text-[12px] text-secondary">Commission on sales</span>
                <span className="font-mono text-[13px] font-bold text-brand-teal">$0</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft px-4 py-2">
                <span className="text-[12px] font-bold text-brand-teal">You keep</span>
                <span className="font-mono text-[14px] font-bold text-brand-teal">$9,901</span>
              </div>
            </div>
            <div className="mt-5 rounded-xl bg-brand-teal-soft border border-default p-3 text-center">
              <span className="font-mono text-2xl font-black text-brand-teal">+$1,051</span>
              <span className="ml-2 text-[12px] text-brand-teal">more in your pocket every month</span>
            </div>
            <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-brand-teal py-3 text-center text-[13px] font-bold text-black transition hover:bg-brand-teal-hover hover:text-white">
              Start free for 60 days →
            </Link>
          </div>
        </div>
      </div>
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
      <div className="flex flex-col items-end gap-2.5 rounded-2xl border border-default/40 bg-surface-card px-2.5 py-3 backdrop-blur-sm">
        {HOME_SECTIONS.map((s) => {
          const isActive = active === s.id;
          return (
            <button key={s.id} onClick={() => scrollTo(s.id)} className="flex items-center gap-2 transition-all duration-200">
              <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors duration-200 ${isActive ? "text-brand-teal" : "text-secondary hover:text-secondary"}`}>
                {s.label}
              </span>
              <span className={`block shrink-0 rounded-full transition-all duration-300 ${isActive ? "h-2.5 w-2.5 bg-brand-teal" : "h-1.5 w-1.5 bg-zinc-700"}`} />
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
  // The deprecated AI-builder hero (type-an-idea → wallet → launch) no
  // longer renders any input, so the wallet-creation branches below are
  // unreachable. Drop the @privy-io/react-auth/solana hook to keep the
  // Solana SDK out of the homepage bundle (~tens of KB on the critical
  // path → measurable mobile LCP/TBT win). user.walletAddress is still
  // sourced via useAuth (live); createWallet is stubbed as a no-op so
  // the unreachable code paths still type-check.
  const walletAddress = user?.walletAddress ?? null;
  const createWallet = async () => {};

  // Hero service-finder search bar and rotating placeholders were
  // removed in the homepage audit pass. The audience-toggle's
  // "I'm shopping" branch is gone; buyer-side discovery now lives
  // entirely at /discover via the navbar.

  // Homepage used to render a category grid with live counts from
  // /api/projects/public. That grid was replaced by a simple quick-
  // search pill row that routes to /discover?q=<label>, so the
  // count-fetching effect is intentionally gone. The shared taxonomy
  // lives at frontend/lib/categories.ts.

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

  // searchResultsRef + heroMode removed in the homepage audit pass —
  // the audience toggle and customer-search panel are gone, so
  // there is no longer a buyer-side search surface on the homepage
  // to scroll into view or mode-switch between.

  // Founding-100 scarcity counter removed from the public hero —
  // we no longer surface live merchant-count metrics to visitors
  // / competitors. The /api/merchant/founding-status endpoint
  // still exists for internal use; nothing on this page fetches
  // it anymore.

  // runHomepageSearch was removed in the homepage audit pass. It
  // had no callers after the audience-toggle "I'm shopping" branch
  // was deleted in the prior repositioning commit. findResults /
  // findExternalResults state is still used by handleHeroLaunch
  // (the legacy AI-launcher path) and stays in place for now —
  // out of scope to delete that whole code path here.

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
    // All conditions met. auto-launch
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
        throw new Error(data?.detail || "Launch failed. Please try again.");
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
            // Backend search failed. show fallback
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

  // Projects that are CURRENTLY streaming (is_live === true). drives the
  // dynamic hero banner. Falls back to the no-streams value-prop state when
  // this list is empty OR when the live-streams hero is disabled by env flag.
  //
  // The feature flag NEXT_PUBLIC_ENABLE_LIVE_STREAMS defaults to OFF per the
  // local-services wedge strategy (Master Playbook Phase 0/1). The Whatnot-
  // style live commerce hero is dormant code, not deleted code. flip the
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

  // Live Now section (top-of-homepage). real data only, not gated by
  // the live-streams env flag because the section is hidden at render
  // time when no projects have is_live === true.
  const liveNowProjects = useMemo(
    () => allPublicProjects.filter((p) => p.is_live === true),
    [allPublicProjects]
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

  // Keep the "Go Live" rail fresh within seconds. Primary path is Supabase
  // realtime on the projects table (is_live flips on go-live / end-live);
  // a slow poll is a fallback for when realtime is gated by RLS or the row
  // isn't in the realtime publication, so liveness still reconciles without
  // a page refresh. Refetch is debounced so a burst of row updates collapses
  // into one reload.
  useEffect(() => {
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const refetch = () => {
      if (cancelled) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!cancelled) loadPublicProjects();
      }, 800);
    };

    let channel: RealtimeChannel | null = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel("home:projects-live")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "projects" },
          () => refetch(),
        )
        .subscribe();
    } catch (err) {
      console.warn("[home] realtime subscribe failed; polling only", err);
    }

    const poll = setInterval(refetch, 30000);

    return () => {
      cancelled = true;
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
      try {
        channel?.unsubscribe();
      } catch {
        /* no-op */
      }
    };
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
    <div className="relative min-h-screen bg-surface-page text-primary" style={{ overflowX: "clip" }}>
      <LiveSaleToast />
      {/* ── Upgrade Modal ── */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowUpgradeModal(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-default bg-surface-card p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.6)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-3xl">🚀</div>
            <h2 className="text-xl font-extrabold text-brand-navy">You&apos;ve used your free businesses</h2>
            <p className="mt-3 text-sm leading-relaxed text-secondary">
              You&apos;ve started {FREE_LAUNCH_LIMIT} businesses for free. Earn DUM Points for unlimited businesses, priority placement, and more.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { icon: "♾️", label: "Unlimited businesses" },
                { icon: "⭐", label: "Featured placement" },
                { icon: "🤖", label: "Unlimited AI" },
              ].map((p) => (
                <div key={p.label} className="rounded-lg border border-default bg-surface-muted p-2 text-center">
                  <div className="text-base">{p.icon}</div>
                  <div className="mt-1 text-[9px] text-secondary">{p.label}</div>
                </div>
              ))}
            </div>
            <Link
              href="/upgrade"
              className="mt-5 block w-full rounded-xl bg-brand-teal px-6 py-3.5 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover"
            >
              View DUM Tiers →
            </Link>
            <button
              type="button"
              onClick={() => setShowUpgradeModal(false)}
              className="mt-3 w-full rounded-xl px-6 py-2 text-sm text-secondary transition hover:text-secondary"
            >
              Maybe later
            </button>
          </div>
        </div>
      )}

      <HomeSectionNav />
      <section className="relative z-[1] mx-auto max-w-7xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
        {/* ── BUSINESSES ON DUM CLUB ── homepage marketplace rail.
             Reuses /discover's ListingGrid + ListingCard verbatim so
             buyers see image-forward, category-pilled merchant cards
             above the existing Live Now rail. Honest count — exactly
             how many rows /api/projects/public returned (CLAUDE.md
             §12.2: no fake inflation). Section hides entirely when
             the list is empty, so the rest of the homepage layout
             below stays byte-for-byte identical to today. Topgun
             (NULL category, only visible merchant in prod) renders
             via the existing classifier + emoji + onError fallback
             chains shipped in #341 / #344. */}
        {allPublicProjects.length > 0 && (
          <div className="mb-12">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-secondary">
                Businesses on DUM Club · {allPublicProjects.length}
              </h2>
              <Link
                href="/discover"
                className="shrink-0 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-teal transition hover:text-brand-teal-hover"
              >
                See all on Discover →
              </Link>
            </div>
            <ListingGrid
              projects={allPublicProjects}
              marketByProject={marketByProject}
              pulseId={null}
            />
          </div>
        )}

        {/* ── LIVE NOW ── hidden when no real live projects.
             Wrapping in an explicit length check stops the component
             tree from emitting *anything* (margins, wrappers, layout
             reservations) when the projects list is empty. Reuses
             /discover's LiveRail (like ListingGrid above) so the
             homepage and discover live cards are one component:
             same /project/{slug}?live=1 link target, same cap-12 +
             "+N more live" overflow, no per-project offer fetches. */}
        {liveNowProjects.length > 0 && (
          <div className="mt-12 sm:mt-16">
            <LiveRail projects={liveNowProjects} />
          </div>
        )}

        {/* ── HERO. light-theme migration (Phase 1) ──
             Switched from the dark glassmorphism panel to a clean
             surface-card on surface-page. Ambient radial-gradient
             orbs (emerald + violet) removed: they were dark-page
             ambience that read as crypto neon on a light surface.
             Copy rewritten to brand-led headline ("DUM Club") +
             slogan ("Drive Your Market") per the migration spec.
             Layout, container widths, and entrance animations
             preserved. */}
        <div
          id="section-hero"
          className="relative overflow-hidden rounded-2xl border border-default bg-surface-card shadow-sm"
        >
          {/* Ambient hero glow. single soft brand-teal radial behind the
               headline. Low opacity (~8%) + heavy blur means it reads as
               warmth around the wordmark rather than as a distinct shape
               (the failure mode of the v1 emerald+violet "neon orbs"
               that were removed during the light-theme migration).
               aria-hidden + pointer-events-none + bounded to the card
               via overflow-hidden on the parent. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 -z-0 h-[480px] w-[880px] -translate-x-1/2 rounded-full opacity-[0.09] blur-3xl"
            style={{
              background:
                "radial-gradient(circle, var(--brand-teal) 0%, transparent 70%)",
            }}
          />
          <div className="relative z-[1] px-6 py-10 sm:px-10 sm:py-12 lg:px-16 lg:py-14">
            <div className="mx-auto mb-10 max-w-4xl text-center">
              {/* Founding-100 scarcity pill removed (PR: hide public
                  merchant-count metrics). The "60 days free" /
                  "Lock in founding pricing for life" copy still
                  appears in the H1 + the two paragraphs below;
                  what we stopped exposing is the live count. */}
              {/* Phase 5 hero. Outcome-led headline with a single
                  plain-English subhead that a non-technical small-
                  business owner reads in five seconds. The brand-
                  decoder eyebrow ("Drive Ur Market") was removed
                  in the simplicity-audit pass — it competed with
                  the value prop for a beat without adding meaning.
                  Brand recognition is carried by the navbar
                  wordmark and the founder note directly below. */}
              <h1 className="text-[clamp(44px,8vw,72px)] font-extrabold leading-[1.04] tracking-[-0.025em] text-primary">
                Sell Live. <span className="text-brand-navy">Keep More of Every Dollar.</span>
              </h1>
              <p className="mx-auto mt-6 max-w-2xl text-base font-medium leading-relaxed text-secondary sm:text-lg">
                Live selling on your own website. Flat monthly subscription plus a 1.5% sales fee. Industry-low.
              </p>
              <p className="mx-auto mt-3 max-w-2xl text-sm font-medium leading-relaxed text-primary sm:text-base">
                <span className="font-bold text-brand-navy">60 days free. Plans start at $39/month + 1.5% sales fee.</span> Keep more of every dollar.
              </p>

              {/* Founder trust row. Personal phone + email were
                  removed before public launch to avoid spam-bot
                  scraping at scale; all inbound now routes through
                  the merchant inquiry form. */}
              <p className="mx-auto mt-4 text-[13px] text-secondary">
                Questions?{" "}
                <Link href="/merchant" className="font-medium text-brand-navy transition hover:text-brand-teal">
                  Contact us through the business inquiry form.
                </Link>
              </p>

              {/* Primary CTA: brand-teal fill with brand-navy text for
                  WCAG AA contrast (~6.2:1). Hover transitions to
                  brand-teal-hover. The old emerald glow shadow is
                  removed for a flatter SaaS feel. */}
              <div className="mt-8 flex flex-col items-center gap-3">
                {/* Two doors: merchants start a trial, shoppers browse what
                    is live right now. The homepage previously offered only
                    the merchant CTA, so shoppers had no entry point. */}
                <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-start sm:justify-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <Link
                      href="/merchant"
                      className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-teal px-6 text-[13px] font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white sm:w-auto"
                    >
                      Start free for 60 days →
                    </Link>
                    {/* Trust microcopy directly under the trial CTA — signup
                        is Privy-auth only; no card is collected to start. */}
                    <p className="text-[11px] font-medium text-secondary">
                      No credit card required
                    </p>
                  </div>
                  <Link
                    href="/discover"
                    className="inline-flex h-12 items-center justify-center rounded-xl border border-default bg-surface-card px-6 text-[13px] font-bold uppercase tracking-[0.12em] text-primary transition hover:border-brand-teal hover:text-brand-teal"
                  >
                    Browse live deals →
                  </Link>
                </div>
                <Link
                  href="/pricing"
                  className="text-[12px] font-bold uppercase tracking-[0.12em] text-secondary transition hover:text-brand-teal"
                >
                  See pricing →
                </Link>
              </div>
            </div>

            <div className="mx-auto max-w-3xl text-center">
              <div className="hero-entrance-delay-2 mx-auto mt-8 space-y-3">
                <p className="text-[13px] text-secondary">
                  Stripe checkout · Verified merchants · Live in 60 seconds
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── SEARCH RESULTS + DEALS removed. the homepage no longer
             has a customer search surface; buyer-side search lives at
             /discover. Founder note + pricing summary moved down to
             just before the Final CTA in the clarity pass so the page
             leads with product (embed preview + how it works) before
             trust + price. ── */}

        {/* ── Platform Activity ──
             Gated behind a trust-safe project-count threshold so
             tiny early-stage numbers ("· 1 live") don't undermine
             credibility. Same spirit as ProofOfMotion's 4-cell
             rule: only render when there's enough volume for the
             component to make the platform look active rather than
             empty. Tune PLATFORM_ACTIVITY_MIN_PROJECTS as the
             merchant base grows. */}
        {allPublicProjects.length >= 5 && (
          <div className="mx-auto mt-6 max-w-4xl">
            <PlatformActivity projectCount={allPublicProjects.length} />
          </div>
        )}

        {/* ── VISUAL PRODUCT MOMENT ─────────────────────────────────
             Static styled mockup of the embed UI as it appears on a
             merchant's own website. NO real data, NO API calls, NO
             IVS. The "Preview" badge is permanent so this can never
             be confused with a real sale. Sample copy is illustrative
             only. these are not live offers. */}
        <div className="mx-auto mt-16 max-w-5xl px-4">
          <div className="mb-6 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
              What it looks like on your site
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl">
              A live storefront, embedded right where your customers already are.
            </h2>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-default bg-surface-card p-4 shadow-[0_0_60px_rgba(0,0,0,0.4)] backdrop-blur-sm sm:p-6">
            {/* Preview badge */}
            <div className="absolute right-4 top-4 z-10 rounded-full border border-default bg-surface-card/90 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-secondary">
              Preview
            </div>

            <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
              {/* Left: live video panel placeholder */}
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-default bg-gradient-to-br from-zinc-900 via-black to-zinc-900">
                {/* LIVE badge */}
                <div className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-state-live px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                  Live
                </div>
                {/* Viewer count */}
                <div className="absolute right-4 top-4 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-mono text-primary backdrop-blur-sm">
                  47 watching
                </div>
                {/* Center play icon. purely decorative */}
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-default bg-brand-teal-soft text-brand-teal">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </div>
                {/* +20 DUM Points toast */}
                <div className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-xl border border-default bg-surface-card/90 px-3 py-2 text-[11px] font-bold text-brand-teal shadow-lg backdrop-blur-sm">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  <span>
                    <span className="text-brand-teal">Customer earned 20 DUM Points</span>
                    <span className="ml-1 text-brand-teal/60 font-normal">· loyalty rewards</span>
                  </span>
                </div>
              </div>

              {/* Right: pinned offer card */}
              <div className="flex flex-col rounded-2xl border border-default bg-surface-card p-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">
                  Now showing
                </div>
                <h3 className="text-lg font-semibold leading-tight text-brand-navy">
                  Slow Hour Flash Deal
                </h3>
                <p className="mt-1 text-sm text-secondary">
                  Limited-time pricing while we&apos;re live.
                </p>
                <div className="mt-4 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-2xl font-bold text-brand-teal">$24.00</span>
                  <span className="text-xs text-secondary">Only 5 left</span>
                </div>
                {/* Countdown */}
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-default bg-surface-card px-2 py-1 text-[10px] font-mono uppercase tracking-[0.12em] text-secondary">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Ends in 14:32
                </div>
                <button
                  type="button"
                  disabled
                  className="mt-4 w-full cursor-default rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-black opacity-90"
                  aria-label="Buy Now button. Preview only."
                >
                  Buy Now
                </button>
                <p className="mt-2 text-center text-[10px] uppercase tracking-[0.15em] text-secondary">
                  Stripe checkout · 1.5% sales fee
                </p>
              </div>
            </div>

            {/* Chat strip */}
            <div className="mt-3 rounded-2xl border border-default bg-surface-card p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
                Live chat
              </div>
              <div className="space-y-1.5 text-[12px]">
                <div>
                  <span className="font-semibold text-brand-teal">Mike:</span>{" "}
                  <span className="text-primary">do you ship to NJ?</span>
                </div>
                <div>
                  <span className="font-semibold text-brand-teal">Sara:</span>{" "}
                  <span className="text-primary">just bought one. thanks!</span>
                </div>
                <div>
                  <span className="font-semibold text-brand-teal">Daniel:</span>{" "}
                  <span className="text-primary">is the deal still live?</span>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-4 text-center text-[12px] text-secondary">
            Sample preview. Embed on any business website with a single script tag.
          </p>
        </div>

        {/* Pain section removed in the homepage audit pass. Its
             strongest line ("You already paid for your website")
             was folded into the Final CTA eyebrow so the page goes
             straight from product surface (visual product moment)
             into proof (5-card comparison) without a small
             text-only interruption between the two visual blocks. */}

        {/* ── FeeCalculator, PricingTiers, RetentionSection, WhatnotPitch,
             ComparisonTable, Features grid, and AI assistant demo all
             moved to /business page (sub-tabs). Homepage stays buyer-
             focused: live grid + search + featured sellers. ── */}

        {/* ── HOW IT WORKS ─────────────────────────────────────────
             Three short steps — the minimum a non-technical owner needs
             to picture the whole flow in five seconds. Sits right after
             the embed preview so the "what" (the bubble on your site) is
             immediately followed by the "how" (three steps to get it). */}
        <ScrollReveal id="how-it-works" className="mx-auto mt-20 max-w-5xl px-4 scroll-mt-24" delay={0.1}>
          <div className="mb-10 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
              How it works
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl">
              Three steps. No developer required.
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                title: "Connect Stripe",
                copy: "One click. Money goes straight to your bank.",
              },
              {
                n: "02",
                title: "Paste one line of code on your site",
                copy: "A small bubble appears in the corner of your website.",
              },
              {
                n: "03",
                title: "Go live and get paid direct",
                copy: "Customers watch and buy. Money lands in your bank.",
              },
            ].map((step) => (
              <div
                key={step.n}
                className="relative overflow-hidden rounded-2xl border border-default bg-surface-card p-6 backdrop-blur-sm transition hover:border-default"
              >
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-default bg-brand-teal-soft font-mono text-sm font-extrabold text-brand-teal">
                  {step.n}
                </div>
                <div className="mt-3 text-base font-bold text-primary">{step.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-primary">{step.copy}</p>
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* ── ONE-FEE-REPLACES-FIVE comparison ────────────────────────
             Visual 5-second scan: the stack of monthly expenses a local
             business already pays vs. one DUM Club flat fee. Numbers
             are public-knowledge ranges, not deep claims about any
             single competitor's pricing. */}
        <div className="mx-auto mt-16 max-w-5xl px-4">
          <div className="mb-8 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
              One flat fee instead of five
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl">
              Stop paying for five things that don&apos;t talk to each other.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-secondary">
              Live selling, loyalty, retention, deals, your storefront. One simple system, one monthly bill.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { name: "Delivery apps", fees: "15 to 30%", detail: "of every order", muted: true },
              { name: "Live selling", fees: "8% + fees", detail: "per sale", muted: true },
              { name: "Loyalty software", fees: "$50 to $300", detail: "per month", muted: true },
              { name: "SMS retention", fees: "$20 to $200", detail: "per month", muted: true },
              { name: "DUM Club", fees: "From $39", detail: "flat / month · 1.5% sales fee", muted: false },
            ].map((p) => (
              <div
                key={p.name}
                className={`rounded-2xl border p-5 text-center backdrop-blur-sm transition ${
                  p.muted
                    ? "border-red-500/15 bg-surface-card"
                    : "border-2 border-brand-teal bg-gradient-to-b from-brand-teal-soft to-zinc-900/60"
                }`}
              >
                <div className={`mb-2 text-[10px] font-bold uppercase tracking-[0.18em] ${p.muted ? "text-secondary" : "text-brand-teal"}`}>
                  {p.name}
                </div>
                <div className={`font-mono text-2xl font-extrabold ${p.muted ? "text-state-live/80" : "text-brand-teal"}`}>
                  {p.fees}
                </div>
                <div className="mt-2 text-[11px] text-secondary">{p.detail}</div>
              </div>
            ))}
          </div>

          <p className="mt-8 text-center text-base font-semibold text-primary">
            One system. One bill.{" "}
            <span className="text-brand-teal">Keep your revenue.</span>
          </p>
        </div>

        {/* ── USE-CASE CARDS ──────────────────────────────────────
             Five concrete local-business angles. Each card answers
             the question "what would I actually use DUM Live for?"
             in one sentence. Industries are deliberately broad. a
             non-technical owner should see themselves in one of
             these in under five seconds. */}
        <ScrollReveal className="mx-auto mt-20 max-w-6xl px-4">
          <div className="mb-10 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
              Built for local business
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl">
              What you can sell live.
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([
              { Icon: UtensilsCrossed, title: "Restaurants", copy: "Go live during slow hours and sell limited-time specials." },
              { Icon: Wrench, title: "Auto shops & mechanics", copy: "Offer same-day service deals, inspections, seasonal promos, or maintenance specials." },
              { Icon: HardHat, title: "HVAC & contractors", copy: "Run flash promotions to fill empty schedule slots: same-day deals, seasonal tune-ups, off-peak pricing." },
              { Icon: Dumbbell, title: "Gyms & wellness", copy: "Sell memberships, classes, recovery sessions, or event promos live." },
              { Icon: ShoppingBag, title: "Retail & local shops", copy: "Move inventory with live product drops and loyalty rewards." },
            ] as Array<{ Icon: LucideIcon; title: string; copy: string }>).map((u) => (
              <div
                key={u.title}
                className="rounded-2xl border border-default bg-surface-card p-6 backdrop-blur-sm transition hover:border-default"
              >
                {/* Lucide icon. Phase 5 emoji-to-icon swap.
                    Inverse-tinted background so the icon reads against
                    the dark feature card; switches to brand-teal when
                    these cards are migrated to light theme later. */}
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-teal-soft text-brand-teal">
                  <u.Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <div className="mb-2 text-base font-bold text-primary">{u.title}</div>
                <p className="text-sm leading-relaxed text-secondary">{u.copy}</p>
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* ── EXPLAINER VIDEO ──────────────────────────────────────
             Loom walkthrough sits right above the How-It-Works
             step cards so the hero's "See How It Works" CTA lands
             on a clear video first, then the textual breakdown
             below. Lazy-loaded, 16:9 responsive. */}
        <ScrollReveal className="mx-auto mt-20 max-w-3xl px-4">
          <div className="mb-6 text-center">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-brand-teal">
              90-second walkthrough
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-brand-navy sm:text-4xl">
              See DUM Club in motion.
            </h2>
          </div>
          <LoomExplainer />
        </ScrollReveal>

        {/* ── ProofOfMotion. pre-final-CTA stats ──
             FounderNote was moved up directly under the hero in
             Phase 5; ProofOfMotion still renders here when its
             4-cell honest-data rule has enough real numbers, but
             the fallback is now null so we don't double-render
             the founder block. */}
        <div className="mx-auto mt-20 max-w-3xl px-4">
          <ProofOfMotion fallback={null} />
        </div>

        {/* ── Founder note ──
             Moved down here in the clarity pass (was directly under
             the hero). The page now leads with product, then closes
             with trust (founder) + price (summary) before the CTA. */}
        <FounderNote />

        {/* ── HOMEPAGE PRICING SUMMARY ──
             Cost upfront, but placed near the close so the page leads
             with product. Three columns; full /pricing behind the
             link. Mobile stacks vertically (sm:grid-cols-3). */}
        <section
          aria-labelledby="homepage-pricing-heading"
          className="mx-auto mt-12 max-w-5xl px-4"
        >
          <h2
            id="homepage-pricing-heading"
            className="sr-only"
          >
            Pricing
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { name: "Starter", price: 39 },
              { name: "Growth", price: 99, highlighted: true },
              { name: "Pro", price: 299 },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl border p-6 text-center transition ${
                  tier.highlighted
                    ? "border-brand-teal bg-brand-teal-soft"
                    : "border-default bg-surface-card"
                }`}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-brand-teal">
                  {tier.name}
                </div>
                <div className="mt-3 text-3xl font-extrabold text-brand-navy">
                  ${tier.price}
                  <span className="text-base font-medium text-secondary">/month</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-secondary">
            Every new business gets 60 days free. Cancel anytime.
          </p>
          <div className="mt-4 text-center">
            <Link
              href="/pricing"
              className="text-[12px] font-bold uppercase tracking-[0.12em] text-secondary transition hover:text-brand-teal"
            >
              See full pricing →
            </Link>
          </div>
        </section>

        {/* ── FINAL CTA ────────────────────────────────────────────
             Single closing block. The previous page had a separate
             "seller banner" + "bottom CTA". collapsed into one to
             match the user-direction "less clutter, clear CTA
             hierarchy." Pricing CTA points at /business; Activate
             CTA points at /merchant. */}
        <div id="section-cta" className="border-t border-default px-4 py-20 mt-20 text-center sm:py-28">
          <div className="mx-auto max-w-2xl">
            <div className="mb-5 text-xs font-bold uppercase tracking-[0.3em] text-brand-teal">
              You already paid for your website
            </div>
            <h2 className="text-4xl font-extrabold tracking-tight text-brand-navy sm:text-5xl">
              Ready to turn your website into a{" "}
              <span className="text-brand-teal">live storefront?</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-primary">
              Starting at $39/month + 1.5% sales fee. Join the first 100 merchants and lock in founding pricing for life.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3">
              <Link
                href="/merchant"
                className="rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold uppercase tracking-[0.12em] text-black transition hover:bg-brand-teal-hover hover:text-white"
              >
                Start free for 60 days →
              </Link>
              <Link
                href="/pricing"
                className="text-[12px] font-bold uppercase tracking-[0.12em] text-secondary transition hover:text-brand-teal"
              >
                See pricing →
              </Link>
            </div>
            {/* Final-CTA closer. The earlier "Drive your market. not
                platform fees." line was removed when "Drive Your
                Market" was promoted to the hero slogan in the
                light-theme migration; the contrast-pair phrasing
                duplicated the new H1 and competed with it. */}
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-default bg-brand-teal-soft px-5 py-3 text-center text-[12px] text-secondary">
              <span className="text-brand-teal">◆</span> Every purchase earns DUM Points. Customers can use them for rewards across the network, redeemable at <strong className="text-primary">any</strong> business on the network.
            </div>
          </div>
        </div>
      </section>

      {/* Trust strip. Phase 5 reframe. Was a "Built with" stack
          credit for Stripe / Supabase / Next.js / Vercel; reframed
          to merchant-facing trust language ("Powered by Stripe ·
          SSL secured · Trusted infrastructure") so the message
          reads as security guarantee rather than tech-stack
          name-drop. The stack credits stay below as the second row
          for builders who want to know what's underneath. */}
      <div className="border-t border-default py-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-5 text-center text-[12px] font-semibold tracking-[0.18em] text-primary sm:text-[13px]">
            Powered by Stripe · SSL secured · Trusted infrastructure
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-3">
            {["Stripe", "Supabase", "Next.js", "Vercel"].map((name) => (
              <span
                key={name}
                className="text-sm font-bold tracking-wide text-secondary"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

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
