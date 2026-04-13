"use client";

/**
 * LiveActivityTicker — thin horizontal marquee below the navbar.
 *
 * Goal: make dum.club feel alive right now.
 *
 * - Pulls real data from /api/checkout/recent-sales and /api/projects/public
 * - Falls back to tasteful demo entries at 80% opacity when activity is sparse
 * - rAF-driven scroll (same pattern as the existing DumActivityStrip)
 * - Dismissible (session-persisted in localStorage)
 * - Mobile-first: small text, thin height, safe to leave running all day
 * - Never polls more than once every 30s
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type TickerItem = {
  key: string;
  icon: string;
  text: string;
  isDemo?: boolean;
};

type RecentSale = {
  id: string;
  amount: number;
  offer_title: string;
  business_name: string;
  created_at?: string;
};

type PublicProject = {
  id: string;
  title?: string;
  name?: string;
  is_live?: boolean;
};

// ── Demo items used only when real activity is thin.
// They're clearly platform-side (not named people) and kept at 80% opacity.
const DEMO_ITEMS: TickerItem[] = [
  { key: "demo-dum-earned", icon: "⭐", text: "Someone just earned DUM Points", isDemo: true },
  { key: "demo-purchase", icon: "🛒", text: "New purchase on DUM Club", isDemo: true },
  { key: "demo-live", icon: "🔴", text: "Live stream active", isDemo: true },
  { key: "demo-merchant", icon: "🏪", text: "New merchant joined", isDemo: true },
  { key: "demo-reward-redeem", icon: "💎", text: "DUM Points redeemed at a local business", isDemo: true },
  { key: "demo-launch", icon: "⚡", text: "New business launched today", isDemo: true },
];

const DISMISS_KEY = "dumclub_ticker_dismissed_at";
const DISMISS_MS = 60 * 60 * 1000; // 1 hour

function shouldShowTicker(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return true;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > DISMISS_MS;
}

function truncate(text: string, max: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

export function LiveActivityTicker() {
  const [visible, setVisible] = useState(false);
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [liveProjects, setLiveProjects] = useState<PublicProject[]>([]);

  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);

  // Dismissal gate: only mount if the user hasn't dismissed in the last hour.
  useEffect(() => {
    setVisible(shouldShowTicker());
  }, []);

  // Poll real activity. Sales are the main signal; live projects are a bonus.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    async function loadSales() {
      try {
        const res = await fetch(`${API_BASE}/api/checkout/recent-sales?limit=8`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSales(Array.isArray(data?.sales) ? data.sales : []);
      } catch {
        // silent — ticker degrades gracefully to demo mode
      }
    }

    async function loadLive() {
      try {
        const res = await fetch(`${API_BASE}/api/projects/public`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list: PublicProject[] = Array.isArray(data) ? data : data?.projects || [];
        setLiveProjects(list.filter((p) => p.is_live === true));
      } catch {
        // silent
      }
    }

    loadSales();
    loadLive();
    const salesTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadSales();
    }, 30000);
    const liveTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadLive();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(salesTimer);
      clearInterval(liveTimer);
    };
  }, [visible]);

  // Compose ticker items: real first, demo to fill.
  const items = useMemo<TickerItem[]>(() => {
    const real: TickerItem[] = [];

    for (const sale of sales) {
      const biz = truncate(sale.business_name || "A seller", 26);
      const what = truncate(sale.offer_title || "an offer", 34);
      real.push({
        key: `sale-${sale.id}`,
        icon: "🛒",
        text: `${biz} just sold ${what}`,
      });
    }

    for (const project of liveProjects) {
      const title = truncate(project.title || project.name || "A creator", 28);
      real.push({
        key: `live-${project.id}`,
        icon: "🔴",
        text: `${title} is live right now`,
      });
    }

    // If we have at least 6 real items, use them as-is. Otherwise pad with demo items.
    if (real.length >= 6) return real;

    const needed = 6 - real.length;
    return [...real, ...DEMO_ITEMS.slice(0, needed)];
  }, [sales, liveProjects]);

  // rAF marquee — continuous scroll, pauses on hover, resumes on leave.
  useEffect(() => {
    if (!visible) return;
    const track = trackRef.current;
    if (!track) return;

    let halfWidth = 0;
    const measure = () => {
      halfWidth = track.scrollWidth / 2;
    };
    const measureTimer = setTimeout(measure, 100);
    window.addEventListener("resize", measure);

    let lastTime = 0;
    const speed = 45; // px/s — tasteful, not casino fast

    const tick = (time: number) => {
      if (lastTime === 0) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;

      if (!pausedRef.current && halfWidth > 0) {
        offsetRef.current -= (speed * delta) / 1000;
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
  }, [visible, items.length]);

  function dismiss() {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setVisible(false);
  }

  if (!visible || items.length === 0) return null;

  const renderItem = (item: TickerItem, keyPrefix: string) => (
    <span
      key={`${keyPrefix}-${item.key}`}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-[11px] tracking-wide"
      style={{ opacity: item.isDemo ? 0.8 : 1 }}
    >
      <span className="text-[13px] leading-none">{item.icon}</span>
      <span className="text-zinc-300">{item.text}</span>
      <span className="mx-4 text-zinc-800">|</span>
    </span>
  );

  return (
    <div
      className="relative w-full border-b border-zinc-900/70 bg-zinc-950/80 backdrop-blur-sm"
      style={{ height: 32 }}
      role="status"
      aria-label="Live platform activity"
    >
      <div
        className="h-full overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 3%, black 97%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 3%, black 97%, transparent)",
          paddingRight: 36, // leave room for dismiss button
        }}
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
      >
        <div
          ref={trackRef}
          className="flex h-full items-center"
          style={{ width: "max-content", willChange: "transform" }}
        >
          {items.map((item) => renderItem(item, "a"))}
          {items.map((item) => renderItem(item, "b"))}
        </div>
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss activity ticker"
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-md text-[14px] text-zinc-600 transition hover:bg-zinc-900 hover:text-zinc-300"
      >
        ×
      </button>
    </div>
  );
}
