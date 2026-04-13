"use client";

/**
 * ProofOfMotion — 4-cell stats strip under the hero CTA.
 *
 * Goal: reinforce activity + legitimacy immediately, every time someone
 * lands on dum.club. Never shows a dead "0" — if a stat is empty we fall
 * back to contextual copy that still reads as positive motion.
 *
 * Data sources (all existing, no backend changes):
 *  - /api/projects/live-stats   → live_projects, active_offers, businesses
 *  - /api/checkout/recent-sales → today's purchase volume
 *
 * DUM Points earned today is derived from today's sales amount using the
 * default network reward rate (10 points per $1). This is an estimate —
 * if we ever ship a real "points awarded today" endpoint, swap it in.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type LiveStats = {
  live_projects: number;
  active_offers: number;
  businesses: number;
};

type RecentSale = {
  id: string;
  amount: number;
  created_at?: string;
};

type StatCell = {
  label: string;
  value: number;
  display: string | null; // when non-null, overrides the number (fallback copy)
};

// ── Reward rate used purely for display-side estimation of points earned today.
// Backend is source of truth for the real value (env DUM_REWARD_RATE, default 10).
const DISPLAY_REWARD_RATE = 10;

function startOfTodayIso(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function countToday(sales: RecentSale[]): { count: number; total: number } {
  const start = startOfTodayIso();
  let count = 0;
  let total = 0;
  for (const s of sales) {
    const t = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (Number.isFinite(t) && t >= start) {
      count += 1;
      total += Number(s.amount || 0);
    }
  }
  return { count, total };
}

/**
 * Small hook: animates a number from 0 → target with requestAnimationFrame.
 * Respects prefers-reduced-motion: if set, snaps to target immediately.
 */
function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      setValue(target);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || target === 0) {
      setValue(target);
      return;
    }

    cancelAnimationFrame(rafRef.current);
    startRef.current = 0;
    const from = 0;

    const tick = (time: number) => {
      if (startRef.current === 0) startRef.current = time;
      const elapsed = time - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return value;
}

function StatCard({ cell }: { cell: StatCell }) {
  const animated = useCountUp(cell.value);
  const showFallback = cell.display !== null;

  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-950/60 px-3 py-3 text-center backdrop-blur-sm transition hover:border-emerald-400/20">
      <div
        className={`font-mono font-extrabold leading-none ${
          showFallback ? "text-[13px] text-zinc-400" : "text-[22px] text-emerald-400"
        }`}
      >
        {showFallback ? cell.display : animated.toLocaleString()}
      </div>
      <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">
        {cell.label}
      </div>
    </div>
  );
}

export function ProofOfMotion() {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [sales, setSales] = useState<RecentSale[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      try {
        const res = await fetch(`${API_BASE}/api/projects/live-stats`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setStats({
          live_projects: Number(data?.live_projects || 0),
          active_offers: Number(data?.active_offers || 0),
          businesses: Number(data?.businesses || 0),
        });
      } catch {
        // silent — fallback copy kicks in
      }
    }

    async function loadSales() {
      try {
        const res = await fetch(`${API_BASE}/api/checkout/recent-sales?limit=20`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSales(Array.isArray(data?.sales) ? data.sales : []);
      } catch {
        // silent
      }
    }

    loadStats();
    loadSales();
    const statsTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadStats();
    }, 120000);
    const salesTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadSales();
    }, 60000);

    return () => {
      cancelled = true;
      clearInterval(statsTimer);
      clearInterval(salesTimer);
    };
  }, []);

  const cells = useMemo<StatCell[]>(() => {
    const today = countToday(sales);
    const dumToday = Math.round(today.total * DISPLAY_REWARD_RATE);
    const liveNow = stats?.live_projects ?? 0;
    const businesses = stats?.businesses ?? 0;

    return [
      {
        label: "Purchases today",
        value: today.count,
        display: today.count > 0 ? null : "Purchases landing daily",
      },
      {
        label: "DUM Points earned today",
        value: dumToday,
        display: dumToday > 0 ? null : "Rewards moving across the market",
      },
      {
        label: "Businesses live now",
        value: liveNow,
        display: liveNow > 0 ? null : "Businesses launching daily",
      },
      {
        label: "Merchants on the network",
        value: businesses,
        display: businesses > 0 ? null : "New merchants joining",
      },
    ];
  }, [stats, sales]);

  return (
    <div
      className="mx-auto mt-8 grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
      aria-label="Platform activity stats"
    >
      {cells.map((cell) => (
        <StatCard key={cell.label} cell={cell} />
      ))}
    </div>
  );
}
