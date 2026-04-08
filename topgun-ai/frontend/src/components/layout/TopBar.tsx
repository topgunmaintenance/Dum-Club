import Link from "next/link";

export function TopBar({ subtitle }: { subtitle?: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-white/[0.06] bg-gunmetal-950/85 px-6 backdrop-blur-xl">
      {/* Crumbs */}
      <div className="hidden items-center gap-2 md:flex">
        <Link
          href="/"
          className="label-eyebrow text-ink-400 transition hover:text-cyan-300"
        >
          Topgun AI
        </Link>
        {subtitle && (
          <>
            <div className="text-ink-600">/</div>
            <div className="text-[12px] font-medium text-ink-100">{subtitle}</div>
          </>
        )}
        <span className="ml-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          live
        </span>
      </div>

      {/* Command bar */}
      <div className="flex flex-1 items-center justify-center">
        <div className="group flex h-10 w-full max-w-xl items-center gap-3 rounded-lg border border-white/[0.08] bg-gunmetal-800/70 px-3 text-[13px] text-ink-300 transition focus-within:border-cyan-500/60 focus-within:shadow-glow">
          <span className="font-mono text-cyan-400">⌕</span>
          <input
            placeholder="Ask manuals, records, and parts data…"
            className="w-full bg-transparent text-ink-100 placeholder:text-ink-500 focus:outline-none"
          />
          <div className="hidden items-center gap-1 md:flex">
            <span className="kbd">/</span>
            <span className="kbd">⌘K</span>
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        <Link href="/query" className="btn-ghost hidden md:inline-flex">
          New query
          <span className="kbd">↵</span>
        </Link>
        <div className="hidden h-8 w-px bg-white/10 md:block" />
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full border border-cyan-500/30 bg-gradient-to-br from-gunmetal-700 to-gunmetal-800 font-mono text-[11px] font-semibold text-cyan-300">
            MA
          </div>
          <div className="hidden text-right md:block">
            <div className="text-[12px] font-semibold text-ink-100">
              M. Alvarez
            </div>
            <div className="label-eyebrow">Mechanic · Demo Op.</div>
          </div>
        </div>
      </div>
    </header>
  );
}
