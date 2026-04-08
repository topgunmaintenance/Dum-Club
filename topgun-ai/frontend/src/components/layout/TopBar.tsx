import Link from "next/link";

export function TopBar({ subtitle }: { subtitle?: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-white/5 bg-gunmetal-950/85 px-6 backdrop-blur-xl">
      <div className="hidden items-center gap-2 md:flex">
        <div className="text-[11px] uppercase tracking-[0.18em] text-ink-400">
          Topgun AI
        </div>
        {subtitle && (
          <>
            <div className="text-ink-500">/</div>
            <div className="text-[12px] text-ink-200">{subtitle}</div>
          </>
        )}
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="group flex h-10 w-full max-w-xl items-center gap-3 rounded-lg border border-white/10 bg-gunmetal-800/70 px-3 text-sm text-ink-300 transition focus-within:border-cyan-500/50 focus-within:shadow-glow">
          <span className="font-mono text-cyan-400">⌕</span>
          <input
            placeholder="Ask manuals, records, parts. Press / to focus."
            className="w-full bg-transparent text-ink-100 placeholder:text-ink-400 focus:outline-none"
          />
          <kbd className="hidden rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-ink-400 md:inline">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Link
          href="/query"
          className="hidden text-[12px] uppercase tracking-[0.18em] text-cyan-300 transition hover:text-cyan-200 md:inline"
        >
          New query
        </Link>
        <div className="hidden h-8 w-px bg-white/10 md:block" />
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-gunmetal-700 font-mono text-xs text-cyan-300">
            MA
          </div>
          <div className="hidden text-right md:block">
            <div className="text-[12px] font-semibold text-ink-100">M. Alvarez</div>
            <div className="text-[10px] uppercase tracking-wider text-ink-400">
              Mechanic · Demo Operator
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
