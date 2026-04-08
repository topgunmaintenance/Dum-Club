"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Dashboard", glyph: "▤", shortcut: "1" },
  { href: "/query", label: "Query Workspace", glyph: "◇", shortcut: "2" },
  { href: "/library", label: "Document Library", glyph: "❐", shortcut: "3" },
  { href: "/insights", label: "Maintenance Insights", glyph: "△", shortcut: "4" },
  { href: "/admin", label: "Admin / System", glyph: "⌬", shortcut: "5" },
];

const FLEET = [
  { name: "Citation XLS", tails: 4, status: "ok" as const },
  { name: "King Air 350", tails: 3, status: "watch" as const },
  { name: "Gulfstream G200", tails: 2, status: "ok" as const },
  { name: "Learjet 60", tails: 1, status: "ok" as const },
];

export function Sidebar() {
  const pathname = usePathname() || "";

  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-gunmetal-900/80 backdrop-blur-xl md:flex">
      {/* Brand */}
      <Link
        href="/"
        className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-5 transition hover:bg-white/[0.02]"
      >
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 text-gunmetal-950 shadow-glow">
          <span className="font-mono text-sm font-bold">T</span>
        </div>
        <div>
          <div className="text-[13px] font-semibold tracking-tight text-ink-100">
            Topgun AI
          </div>
          <div className="label-eyebrow">Maintenance Intelligence</div>
        </div>
      </Link>

      {/* Workspace */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-5">
        <div className="label-eyebrow mb-2 px-2">Workspace</div>
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group relative flex items-center justify-between rounded-lg px-3 py-2 text-[13px] transition ${
                active
                  ? "bg-cyan-500/[0.08] text-cyan-100"
                  : "text-ink-300 hover:bg-white/[0.03] hover:text-ink-100"
              }`}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
              )}
              <span className="flex items-center gap-3 pl-2">
                <span
                  className={`text-[13px] ${
                    active ? "text-cyan-300" : "text-ink-400 group-hover:text-cyan-300"
                  }`}
                >
                  {item.glyph}
                </span>
                {item.label}
              </span>
              <span className="kbd opacity-0 group-hover:opacity-100">
                {item.shortcut}
              </span>
            </Link>
          );
        })}

        {/* Fleet */}
        <div className="label-eyebrow mb-2 mt-7 px-2">Fleet · 10 tails</div>
        {FLEET.map((aircraft) => (
          <button
            key={aircraft.name}
            className="group flex items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12.5px] text-ink-300 transition hover:bg-white/[0.03] hover:text-ink-100"
          >
            <span className="flex items-center gap-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  aircraft.status === "watch"
                    ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]"
                    : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                }`}
              />
              {aircraft.name}
            </span>
            <span className="mono-meta">{aircraft.tails}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/[0.06] p-3">
        <div className="panel-tight px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="label-eyebrow text-cyan-300">Demo mode</div>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-400">
            Seeded sample data. Wire a real provider in{" "}
            <code className="rounded bg-black/30 px-1 font-mono text-[10px] text-ink-200">
              .env
            </code>{" "}
            to go live.
          </p>
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.16em] text-ink-500">
          <span>v0.1.0</span>
          <span>build · mvp</span>
        </div>
      </div>
    </aside>
  );
}
