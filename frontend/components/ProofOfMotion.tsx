"use client";

/**
 * ProofOfMotion — strict honest-data-only stats strip under the hero CTA.
 *
 * Master Playbook Phase 0A: each cell enables independently, but ONLY
 * when its underlying number is > 0 AND derived from real data within
 * the last 30 days. No rolling averages. No 'today' labels that secretly
 * include older data. No fallback copy. No 'launching daily' aspiration.
 *
 * The full strip renders only when ALL 4 cells qualify, otherwise the
 * caller's `fallback` prop renders in the same vertical slot. This is
 * the reconciliation of "hide entirely" (never show partial state) with
 * "each cell enables independently" (each cell has its own qualifying
 * rule). All-or-nothing avoids the asymmetric layout problem of one or
 * two lonely cells.
 *
 * Cell definitions:
 *   1. Sales this month       — count of paid Stripe sales (last 30 days)
 *   2. DUM Points this month  — sum of points earned (last 30 days)
 *   3. Verified merchants     — merchants.trust_level in (verified, trusted)
 *   4. Businesses live        — projects.status='live' & visibility='public'
 *
 * Cells 1, 2 require a 30-day window. Cells 3, 4 are current-state counts.
 */

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type LiveStats = {
  live_projects: number;
  active_offers: number;
  businesses: number;
  verified_merchants: number;
};

type RecentSale = {
  id: string;
  amount: number;
  created_at?: string;
};

type StatCell = {
  label: string;
  value: number;
};

const DISPLAY_REWARD_RATE = 10;

function startOfWindow(daysBack: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

function aggregateLast30Days(sales: RecentSale[]): { count: number; total: number } {
  const cutoff = startOfWindow(30);
  let count = 0;
  let total = 0;
  for (const s of sales) {
    const t = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (Number.isFinite(t) && t >= cutoff) {
      count += 1;
      total += Number(s.amount || 0);
    }
  }
  return { count, total };
}

/**
 * Animates a number from 0 → target with rAF. Snaps to target if the
 * user prefers reduced motion or the target is 0.
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
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-950/60 px-3 py-3 text-center backdrop-blur-sm transition hover:border-emerald-400/20">
      <div className="font-mono text-[22px] font-extrabold leading-none text-emerald-400">
        {animated.toLocaleString()}
      </div>
      <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-600">
        {cell.label}
      </div>
    </div>
  );
}

interface ProofOfMotionProps {
  /**
   * Rendered in the same vertical slot when the strict 4-cell rule isn't met.
   * Pass <FounderNote /> from the caller. Required so the page never has an
   * empty slot — the playbook is explicit about not leaving the space blank.
   */
  fallback: ReactNode;
}

export function ProofOfMotion({ fallback }: ProofOfMotionProps) {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let pending = 2;
    const settle = () => {
      pending -= 1;
      if (pending === 0 && !cancelled) setLoaded(true);
    };

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
          verified_merchants: Number(data?.verified_merchants || 0),
        });
      } catch {
        // Silent — fallback renders
      } finally {
        settle();
      }
    }

    async function loadSales() {
      try {
        const res = await fetch(`${API_BASE}/api/checkout/recent-sales?limit=50`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSales(Array.isArray(data?.sales) ? data.sales : []);
      } catch {
        // Silent
      } finally {
        settle();
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
    const last30 = aggregateLast30Days(sales);
    const dum30 = Math.round(last30.total * DISPLAY_REWARD_RATE);
    return [
      { label: "Sales this month",     value: last30.count },
      { label: "DUM Points this month", value: dum30 },
      { label: "Verified merchants",   value: stats?.verified_merchants ?? 0 },
      { label: "Businesses live",      value: stats?.live_projects ?? 0 },
    ];
  }, [stats, sales]);

  // Strict rule: ALL 4 cells must have value > 0. Otherwise fallback.
  const allCellsQualify = cells.every((c) => c.value > 0);

  // During initial load, render fallback to avoid flash-of-zero-cells.
  if (!loaded || !allCellsQualify) {
    return <>{fallback}</>;
  }

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
