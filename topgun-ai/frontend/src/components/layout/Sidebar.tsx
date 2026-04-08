import Link from "next/link";

const NAV = [
  { href: "/dashboard", label: "Dashboard", glyph: "▤" },
  { href: "/query", label: "Query Workspace", glyph: "◇" },
  { href: "/library", label: "Document Library", glyph: "❐" },
  { href: "/insights", label: "Maintenance Insights", glyph: "△" },
  { href: "/admin", label: "Admin / System", glyph: "⌬" },
];

export function Sidebar() {
  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-gunmetal-900/80 backdrop-blur md:flex">
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 text-gunmetal-950 shadow-glow">
          <span className="font-mono text-sm font-bold">T</span>
        </div>
        <div>
          <div className="text-sm font-semibold text-ink-100">Topgun AI</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-ink-400">
            Maintenance Intelligence
          </div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 pb-6">
        <div className="px-2 pb-2 text-[10px] uppercase tracking-[0.2em] text-ink-500">
          Workspace
        </div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-center justify-between rounded-lg px-3 py-2 text-sm text-ink-200 transition hover:bg-cyan-500/5 hover:text-cyan-200"
          >
            <span className="flex items-center gap-3">
              <span className="text-cyan-400/70 group-hover:text-cyan-300">
                {item.glyph}
              </span>
              {item.label}
            </span>
          </Link>
        ))}

        <div className="mt-6 px-2 pb-2 text-[10px] uppercase tracking-[0.2em] text-ink-500">
          Fleet
        </div>
        {[
          "Citation XLS",
          "King Air 350",
          "Gulfstream G200",
          "Learjet 60",
        ].map((aircraft) => (
          <button
            key={aircraft}
            className="rounded-lg px-3 py-1.5 text-left text-[13px] text-ink-300 transition hover:bg-white/5 hover:text-ink-100"
          >
            {aircraft}
          </button>
        ))}
      </nav>

      <div className="mx-3 mb-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-[11px] text-ink-300">
        <div className="mb-1 font-semibold uppercase tracking-wider text-cyan-300">
          Demo mode
        </div>
        Backed by seeded sample data. Wire a real provider in
        <code className="mx-1 rounded bg-black/30 px-1 py-px font-mono text-[10px]">
          .env
        </code>
        to go live.
      </div>
    </aside>
  );
}
