"use client";

/**
 * LiveActivityTicker — thin horizontal marquee below the navbar.
 *
 * REAL DATA ONLY. No demo items, no fallback, no fabricated entries.
 * The Master Playbook (Phase 0A) is unambiguous: "If there's no real
 * sales data yet, hide the ticker entirely rather than fake it."
 *
 * Threshold rule: the ticker only renders when there are at least 5
 * real Stripe sales (paid OR fulfilled) on the platform. Once the
 * threshold is crossed, it stays on — we deliberately do NOT gate on
 * a sliding "last 24h" window because the ticker would flicker on and
 * off as transactions age out, which looks broken. Five paid sales
 * total, ever, is the floor.
 *
 * Data source: GET /api/checkout/recent-sales?limit=10 — the existing
 * public endpoint that returns the most recent paid/fulfilled orders.
 * If the array length is < 5, the ticker mounts as null (returns
 * nothing). If >= 5, the ticker renders the items in a continuous
 * rAF marquee, dismissible via the × button.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type RecentSale = {
  id: string;
  amount: number;
  offer_title: string;
  business_name: string;
  created_at?: string;
};

type TickerItem = {
  key: string;
  icon: string;
  text: string;
};

// Real data only. The ticker renders when sales.length >= REAL_SALES_FLOOR.
const REAL_SALES_FLOOR = 5;

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
  const [dismissed, setDismissed] = useState(true);
  const [sales, setSales] = useState<RecentSale[]>([]);

  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);

  // Dismissal gate: only mount if the user hasn't dismissed in the last hour.
  // Default to dismissed (true) so the ticker never flashes during SSR/hydration
  // before the localStorage check runs.
  useEffect(() => {
    setDismissed(!shouldShowTicker());
  }, []);

  // Poll real sales every 60s. No live-stream polling — the live-streams
  // hero is feature-flagged off (03a4999) so showing live-stream items here
  // would contradict that gate. Sales-only ticker.
  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;

    async function loadSales() {
      try {
        const res = await fetch(`${API_BASE}/api/checkout/recent-sales?limit=20`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        // Phase 4 sales-ticker hygiene: filter out test orders (offer
        // titles containing "test" / "testing" case-insensitive) and
        // micro-amounts under $1. These show up during Stripe-mode
        // verification + accidental $0.99 demos and they make the
        // homepage look like a sandbox.
        const raw = Array.isArray(data?.sales) ? data.sales : [];
        const cleaned = raw.filter((s: any) => {
          const title = String(s?.offer_title || "").toLowerCase();
          if (/\btest(ing)?\b/.test(title)) return false;
          const amount = Number(s?.amount ?? 0);
          if (!Number.isFinite(amount) || amount < 1) return false;
          return true;
        });
        setSales(cleaned.slice(0, 10));
      } catch {
        // Silent — empty state correctly hides the ticker.
      }
    }

    loadSales();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadSales();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dismissed]);

  // Real sale items only. No padding, no demo, no fallback.
  const items = useMemo<TickerItem[]>(() => {
    return sales.map((sale) => {
      const biz = truncate(sale.business_name || "A seller", 26);
      const what = truncate(sale.offer_title || "an offer", 34);
      return {
        key: `sale-${sale.id}`,
        icon: "🛒",
        text: `${biz} just sold ${what}`,
      };
    });
  }, [sales]);

  const aboveFloor = items.length >= REAL_SALES_FLOOR;

  // rAF marquee — runs only when the ticker is actually rendered.
  useEffect(() => {
    if (dismissed || !aboveFloor) return;
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
  }, [dismissed, aboveFloor, items.length]);

  function dismiss() {
    if (typeof window !== "undefined") {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
    setDismissed(true);
  }

  // Hide entirely until the platform crosses the real-sales floor.
  // Dismissed by user → also hidden.
  if (dismissed || !aboveFloor) return null;

  const renderItem = (item: TickerItem, keyPrefix: string) => (
    <span
      key={`${keyPrefix}-${item.key}`}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap font-mono text-[11px] tracking-wide"
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
      aria-label="Recent sales on DUM Club"
    >
      <div
        className="h-full overflow-hidden"
        style={{
          // Pixel-based fade (24px) instead of percentage so the fade
          // is wide enough to soften partial words at every viewport
          // size. The 3% original looked clean on desktop (~36px on a
          // 1200px screen) but degenerated to ~12px on a 393px phone,
          // which read as a hard cut with partial letters bleeding.
          maskImage: "linear-gradient(to right, transparent 0px, black 24px, black calc(100% - 24px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, transparent 0px, black 24px, black calc(100% - 24px), transparent 100%)",
          paddingRight: 36, // room for dismiss button
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
