"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Project = {
  id: string;
  name?: string;
  title?: string;
  description?: string | null;
  template_type?: string;
  token_symbol?: string | null;
  token_utility?: string | null;
  promo_copy?: string | null;
  store_items?: any[] | null;
  created_at?: string;
};

type MarketSnapshot = {
  price: number;
  market_cap: number;
  volume_24h: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getTicker(p: Project) {
  if (p.token_symbol?.trim()) return p.token_symbol.replace(/^\$/, "").toUpperCase().slice(0, 10);
  return "";
}

export default function LeaderboardPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/projects/public`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const list = Array.isArray(data?.projects) ? data.projects : Array.isArray(data) ? data : [];
        setProjects(list);

        const snaps = await Promise.all(
          list.map(async (p: Project) => {
            try {
              const r = await fetch(`${API_BASE}/api/projects/${p.id}/market`, { cache: "no-store" });
              if (!r.ok) return [p.id, null] as const;
              const d = await r.json();
              return [p.id, { price: Number(d?.price || 0), market_cap: Number(d?.market_cap || 0), volume_24h: Number(d?.volume_24h || 0) }] as const;
            } catch {
              return [p.id, null] as const;
            }
          })
        );
        const map: Record<string, MarketSnapshot> = {};
        for (const [id, snap] of snaps) { if (snap) map[id] = snap; }
        setMarketByProject(map);
      } catch {
        setProjects([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function readinessScore(p: Project): number {
    let s = 0;
    if (p.description && p.description.length > 20) s += 20;
    if (p.token_utility && p.token_utility.length > 10) s += 20;
    if (p.promo_copy && p.promo_copy.length > 10) s += 20;
    if (Array.isArray(p.store_items) && p.store_items.length > 0) s += 20;
    if (Array.isArray(p.store_items) && p.store_items.some((i: any) => i.type === "subscription")) s += 10;
    if ((marketByProject[p.id]?.volume_24h || 0) > 0) s += 10;
    return s;
  }

  const ranked = useMemo(() => {
    return [...projects]
      .map((p) => ({ ...p, score: readinessScore(p) }))
      .sort((a, b) => b.score - a.score);
  }, [projects, marketByProject]);

  function scoreColor(s: number) {
    if (s >= 75) return "text-emerald-400";
    if (s >= 50) return "text-amber-400";
    return "text-zinc-500";
  }

  function barColor(s: number) {
    if (s >= 75) return "bg-emerald-400";
    if (s >= 50) return "bg-amber-400";
    return "bg-zinc-700";
  }

  function rankBadge(rank: number) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return null;
  }

  return (
    <main className="min-h-screen bg-base text-white">
      <section className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href="/discover"
          className="mb-8 inline-flex rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2 text-xs uppercase tracking-[0.25em] text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-300"
        >
          ← Back to Discover
        </Link>

        <div className="mb-2 text-xs uppercase tracking-[0.35em] text-emerald-400/60">
          Ranking
        </div>
        <h1 className="text-3xl font-bold uppercase tracking-[-0.04em] text-white sm:text-4xl">
          Leaderboard
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Projects ranked by readiness score — description, utility, offers, and market activity
        </p>

        {loading ? (
          <div className="mt-8 rounded-2xl border border-zinc-900 bg-zinc-950 p-8 text-center text-zinc-500">
            Loading projects...
          </div>
        ) : ranked.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-zinc-900 bg-zinc-950 p-8 text-center text-zinc-500">
            No public projects yet
          </div>
        ) : (
          <div className="mt-8 space-y-2">
            {ranked.map((p, i) => {
              const rank = i + 1;
              const medal = rankBadge(rank);
              const ticker = getTicker(p);
              const offerCount = Array.isArray(p.store_items) ? p.store_items.length : 0;
              return (
                <Link key={p.id} href={`/project/${p.id}`}>
                  <div className={`flex items-center gap-4 rounded-2xl border p-4 transition ${
                    rank <= 3
                      ? "border-emerald-400/15 bg-emerald-400/[0.02] hover:border-emerald-400/30"
                      : "border-zinc-900 bg-zinc-950 hover:border-zinc-700"
                  }`}>
                    {/* Rank */}
                    <div className="w-10 text-center">
                      {medal ? (
                        <span className="text-lg">{medal}</span>
                      ) : (
                        <span className="font-mono text-sm font-bold text-zinc-600">{rank}</span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {p.title || p.name || "New Business"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {p.token_utility && (
                          <span className="rounded-full border border-purple-400/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-purple-400">
                            Utility
                          </span>
                        )}
                        {offerCount > 0 && (
                          <span className="rounded-full border border-sky-400/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-sky-400">
                            {offerCount} offer{offerCount > 1 ? "s" : ""}
                          </span>
                        )}
                        {p.promo_copy && (
                          <span className="rounded-full border border-amber-400/20 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-amber-400">
                            Promo
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Score */}
                    <div className="w-20 text-right">
                      <div className={`font-mono text-lg font-bold ${scoreColor(p.score)}`}>
                        {p.score}
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${barColor(p.score)}`}
                          style={{ width: `${p.score}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
