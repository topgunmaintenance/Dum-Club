"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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

/* ─── AI Chat Demo for Hero ─── */
function HeroChatDemo() {
  const [step, setStep] = useState(0);
  const [buildIdx, setBuildIdx] = useState(0);
  const buildSteps = [
    "Analyzing idea...",
    "Creating project page...",
    "Setting up offers...",
    "Configuring payments...",
    "✓ Live!",
  ];

  useEffect(() => {
    const delays = [600, 2000, 3200, 4400, 6000];
    const timers = delays.map((d, i) => setTimeout(() => setStep(i + 1), d));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (step !== 4) return;
    let i = 0;
    const t = setInterval(() => {
      i++;
      setBuildIdx(i);
      if (i >= buildSteps.length - 1) clearInterval(t);
    }, 350);
    return () => clearInterval(t);
  }, [step]);

  return (
    <div className="w-full max-w-[340px] rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-2xl shadow-black/50 overflow-hidden">
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

      {/* Chat body */}
      <div className="space-y-3 px-4 py-4" style={{ minHeight: 280 }}>
        {/* AI greeting */}
        {step >= 1 && (
          <div className="hero-chat-msg flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 text-[9px] font-extrabold text-black">
              D
            </div>
            <div className="max-w-[78%] rounded-bl-2xl rounded-br-2xl rounded-tr-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-[13px] leading-relaxed text-zinc-300">
              What&apos;s your business idea? I&apos;ll build it for you.
            </div>
          </div>
        )}

        {/* User message */}
        {step >= 2 && (
          <div className="hero-chat-msg flex justify-end">
            <div className="max-w-[78%] rounded-bl-2xl rounded-br-2xl rounded-tl-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[13px] leading-relaxed text-emerald-100">
              I want to start a mobile car wash business
            </div>
          </div>
        )}

        {/* AI response */}
        {step >= 3 && (
          <div className="hero-chat-msg flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 text-[9px] font-extrabold text-black">
              D
            </div>
            <div className="max-w-[78%] rounded-bl-2xl rounded-br-2xl rounded-tr-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-[13px] leading-relaxed text-zinc-300">
              On it — building your business now.
            </div>
          </div>
        )}

        {/* Build progress */}
        {step >= 4 && (
          <div className="hero-chat-msg flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-emerald-400 text-[9px] font-extrabold text-black">
              D
            </div>
            <div className="rounded-bl-2xl rounded-br-2xl rounded-tr-2xl border border-violet-500/15 bg-violet-500/[0.06] px-3 py-2.5 font-mono text-[11px] leading-[1.8] text-zinc-500">
              {buildSteps.slice(0, buildIdx + 1).map((line, i) => (
                <div
                  key={i}
                  className={
                    i === buildIdx && buildIdx < buildSteps.length - 1
                      ? "text-emerald-400"
                      : i < buildIdx
                      ? "text-zinc-600"
                      : "text-emerald-400"
                  }
                >
                  {line}
                </div>
              ))}
              {buildIdx < buildSteps.length - 1 && (
                <span className="hero-chat-typing inline-flex gap-0.5 text-emerald-400">
                  <span>.</span><span>.</span><span>.</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Final live card */}
        {step >= 5 && (
          <div className="hero-chat-card rounded-xl border border-emerald-400/25 bg-gradient-to-br from-emerald-400/[0.07] to-violet-500/[0.07] p-3.5">
            <div className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-400">
              ✓ LIVE · DUM.CLUB/SPARKLE-WASH
            </div>
            <div className="mb-0.5 text-[15px] font-bold text-white">
              Sparkle Mobile Wash
            </div>
            <div className="mb-3 text-[12px] text-zinc-400">
              Premium mobile car detailing at your doorstep
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-zinc-500">Starting at</div>
                <div className="text-lg font-extrabold text-emerald-400">$49</div>
              </div>
              <div className="rounded-full bg-emerald-400 px-4 py-1.5 text-[11px] font-bold text-black">
                Book Now
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 border-t border-zinc-800/80 bg-zinc-950 px-3 py-2.5">
        <div className="flex-1 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-[12px] text-zinc-600">
          Describe what you offer...
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500 text-[11px] text-white">
          ↑
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [allPublicProjects, setAllPublicProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [marketByProject, setMarketByProject] = useState<Record<string, MarketSnapshot>>({});
  const marketPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    <div className="min-h-screen overflow-hidden bg-base text-white">
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-8 sm:px-6 sm:pt-12">
        {/* ── HERO ── */}
        <div className="relative overflow-hidden border border-zinc-900 bg-base">
          {/* Ambient background */}
          <div className="absolute inset-0">
            <div className="h-full w-full bg-[radial-gradient(ellipse_at_top_center,rgba(0,255,163,0.10),transparent_50%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(123,97,255,0.06),transparent_50%)]" />
          </div>

          <div className="relative px-6 py-16 sm:px-10 sm:py-20 lg:px-16 lg:py-28">
            <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_auto] lg:gap-20">

              {/* LEFT — Message */}
              <div>
                <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Turn any idea into
                  <br />
                  <span className="text-emerald-400">a funded business.</span>
                </h1>

                <div className="mt-8 space-y-1">
                  <p className="text-lg font-medium text-zinc-200 sm:text-xl">
                    Describe your idea.
                  </p>
                  <p className="text-lg font-medium text-zinc-200 sm:text-xl">
                    AI builds it.
                  </p>
                  <p className="text-lg font-medium text-emerald-400 sm:text-xl">
                    Start selling instantly.
                  </p>
                </div>

                <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:gap-4">
                  <Link
                    href="/build"
                    className="group inline-flex items-center justify-center rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold uppercase tracking-[0.15em] text-black transition hover:bg-emerald-300 hover:shadow-[0_0_30px_rgba(0,255,163,0.3)] sm:w-auto"
                  >
                    Start Building
                    <span className="ml-2 inline-block transition-transform duration-150 ease-out group-hover:translate-x-1">
                      →
                    </span>
                  </Link>

                  <Link
                    href="/discover"
                    className="inline-flex items-center justify-center rounded-xl border border-zinc-700 px-8 py-4 text-sm uppercase tracking-[0.15em] text-zinc-300 transition hover:border-zinc-500 hover:text-white sm:w-auto"
                  >
                    See Live Example
                  </Link>
                </div>

                <p className="mt-5 text-[13px] text-zinc-500">
                  No website needed · No developer required · No crypto knowledge
                </p>
              </div>

              {/* RIGHT — AI Chat Demo */}
              <div className="flex justify-center lg:justify-end">
                <HeroChatDemo />
              </div>

            </div>
          </div>
        </div>

        <div
          id="how-it-works"
          className="mx-auto mt-16 max-w-6xl border border-zinc-900 bg-zinc-950/40 px-6 py-10 sm:px-10"
        >
          <div className="mb-2 text-xs uppercase tracking-[0.35em] text-emerald-400">
            How it works
          </div>
          <h2 className="text-2xl font-bold uppercase tracking-tight text-white sm:text-3xl">
            60 seconds to live
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-400">
            Describe your idea, we generate the workspace and token metadata, then your project
            page goes live with a public market feed and holder utility. Most launches surface in
            under a minute.
          </p>
          <div className="mt-8 grid gap-6 border-t border-zinc-800 pt-8 sm:grid-cols-3">
            <div>
              <div className="font-mono text-2xl font-bold text-zinc-700">01</div>
              <div className="mt-2 text-sm font-semibold text-white">Idea</div>
              <p className="mt-2 text-sm text-zinc-500">One paragraph is enough to start.</p>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-zinc-700">02</div>
              <div className="mt-2 text-sm font-semibold text-white">Generate</div>
              <p className="mt-2 text-sm text-zinc-500">AI drafts the app shape and token story.</p>
            </div>
            <div>
              <div className="font-mono text-2xl font-bold text-zinc-700">03</div>
              <div className="mt-2 text-sm font-semibold text-white">Launch</div>
              <p className="mt-2 text-sm text-zinc-500">Your page is live and discoverable.</p>
            </div>
          </div>
        </div>

        {/* Live activity ticker */}
        <div className="mx-auto mt-16 max-w-7xl border-t border-zinc-900">
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
              No recent trades yet — open a market and make the first move.
            </div>
          ) : (
            <div className="overflow-hidden py-3">
              <div className="home-marquee-track gap-8">
                {recentTrades.concat(recentTrades).map((trade, i) => {
                  const side = trade.side === "sell" ? "sell" : "buy";
                  const price = Number(trade.price ?? 0);
                  const sym = trade.token_symbol || "—";
                  return (
                    <span
                      key={`t-${i}`}
                      className="flex shrink-0 items-center font-mono text-xs text-zinc-500"
                    >
                      <span
                        className={
                          side === "buy" ? "text-emerald-400" : "text-red-400"
                        }
                      >
                        {side === "buy" ? "↑" : "↓"}
                      </span>{" "}
                      {sym} · ${formatPrice(price)} · {formatTimeAgo(trade.created_at)}
                      <span className="mx-4 text-zinc-800">|</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Featured project spotlight */}
        <div className="border-t border-zinc-900 px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="mb-3 text-[10px] uppercase tracking-[0.3em] text-zinc-600">
              Featured project
            </div>
            {featured?.project && (
              <Link href={`/project/${featured.project.id}`}>
                <div
                  className="group rounded-3xl border border-zinc-800 bg-zinc-950 p-8 transition hover:border-emerald-400/30"
                  style={{ borderTop: "3px solid rgba(52,211,153,0.5)" }}
                >
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-start gap-5">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-base text-3xl">
                        {getProjectEmoji(featured.project, 0)}
                      </div>
                      <div>
                        <div className="text-2xl font-black text-white">
                          {featured.project.title || featured.project.name || "Untitled"}
                        </div>
                        <div className="mt-1 max-w-lg text-sm text-zinc-400">
                          {featured.project.description || "No description yet."}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] text-emerald-400">
                            ${getTicker(featured.project)}
                          </span>
                          <span className="rounded-full border border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-500">
                            {featured.project.token_utility || "Token-gated AI access"}
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
                        Open market →
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
        <div className="border-t border-zinc-900 bg-zinc-950/30 px-4 py-12 sm:py-14">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-600">
              Platform pulse
            </div>
            <div className="grid grid-cols-2 gap-8 lg:grid-cols-4">
              {[
                {
                  label: "Projects live",
                  value: allPublicProjects.length.toString(),
                },
                { label: "AI questions answered", value: "∞" },
                {
                  label: "Tokens created",
                  value: allPublicProjects.length.toString(),
                },
                { label: "Built on Solana", value: "✓" },
              ].map((stat) => (
                <div key={stat.label} className="text-center">
                  <div className="font-mono text-3xl font-black text-white sm:text-4xl">
                    {stat.value}
                  </div>
                  <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="border-t border-zinc-900 px-4 py-14 text-center sm:py-16">
          <div className="mx-auto max-w-2xl">
            <div className="mb-4 text-[10px] uppercase tracking-[0.3em] text-zinc-600">
              Ready?
            </div>
            <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              YOUR IDEA.
              <br />
              <span className="text-emerald-400">60 SECONDS.</span>
            </h2>
            <p className="mx-auto mt-6 max-w-md text-zinc-500">
              Describe it. We build the AI, the token, and the market. Supporters join early. Holders back ideas and grow with them.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href="/build"
                className="rounded-xl bg-emerald-400 px-8 py-4 text-sm font-bold text-black transition hover:bg-emerald-300"
              >
                Build a Project →
              </Link>
              <Link
                href="/discover"
                className="rounded-xl border border-zinc-700 px-8 py-4 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-white"
              >
                Explore Feed
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Latest — real public projects */}
      <div className="border-t border-zinc-900 px-4 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 text-[10px] uppercase tracking-[0.3em] text-zinc-600">
            Latest on DUM Club
          </div>
          {latestProjectsNews.length === 0 && !loadingProjects ? (
            <p className="text-sm text-zinc-600">
              {allPublicProjects.length === 0
                ? "No public projects yet — launch one and it will show up here."
                : "Projects with real descriptions (not placeholders) will appear here."}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              {loadingProjects && latestProjectsNews.length === 0
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-950"
                    />
                  ))
                : latestProjectsNews.map((p) => (
                    <Link
                      key={p.id}
                      href={`/project/${p.id}`}
                      className="block rounded-xl border border-zinc-800 bg-zinc-950 p-5 transition hover:border-zinc-700"
                    >
                      <div className="mb-2 font-mono text-[10px] text-emerald-500">
                        {formatNewsDate(p.created_at)}
                      </div>
                      <div className="mb-2 text-sm font-bold leading-tight text-white">
                        {p.title || p.name || "Untitled project"}
                      </div>
                      <div className="line-clamp-3 text-xs leading-relaxed text-zinc-500">
                        {p.description?.trim() || "Live on DUM Club with token-gated AI and markets."}
                      </div>
                    </Link>
                  ))}
            </div>
          )}
        </div>
      </div>

      {/* Honest stack strip (no fake press logos) */}
      <div className="border-t border-zinc-900 py-8">
        <div className="mx-auto max-w-5xl px-4">
          <div className="mb-4 text-center text-[9px] uppercase tracking-[0.3em] text-zinc-700">
            Built with
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {["Solana", "Supabase", "Next.js"].map((name) => (
              <span
                key={name}
                className="text-sm font-bold tracking-wide text-zinc-500"
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
              <p className="mb-4 text-[9px] uppercase tracking-[0.2em] text-zinc-600">
                DIGITAL UTILITY MOVEMENT
              </p>
              <p className="max-w-xs text-sm leading-relaxed text-zinc-500">
                Build AI-powered projects on Solana. Token holders back ideas early. Markets move with demand.
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
                  { label: "How it works", href: "/#how-it-works" },
                  { label: "Token economics", href: "#" },
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
