"use client";

import { useState } from "react";

const FILTERS = [
  { id: "all", label: "All sources" },
  { id: "AMM", label: "Manuals" },
  { id: "WORK_ORDER", label: "Work Orders" },
  { id: "LOGBOOK", label: "Logbook" },
  { id: "SB", label: "Service Bulletins" },
];

const AIRCRAFT = [
  "All aircraft",
  "Citation XLS",
  "King Air 350",
  "Gulfstream G200",
  "Learjet 60",
];

export function QueryInput({ initialQuestion }: { initialQuestion: string }) {
  const [value, setValue] = useState(initialQuestion);
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeAircraft, setActiveAircraft] = useState(AIRCRAFT[0]);

  return (
    <section className="panel-accent relative overflow-hidden p-5">
      <div className="flex items-center justify-between">
        <label className="label-eyebrow text-cyan-300">Ask Topgun AI</label>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-500">
          <span className="kbd">/</span> focus
          <span className="ml-2 kbd">↵</span> run
          <span className="ml-2 kbd">⌘K</span> palette
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-gunmetal-900/80 px-4 py-3 transition focus-within:border-cyan-500/60 focus-within:shadow-glow">
        <span className="font-mono text-lg text-cyan-400">⌕</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe a fault, ask for a procedure, or look up a part…"
          className="w-full bg-transparent text-[15px] text-ink-100 placeholder:text-ink-500 focus:outline-none"
        />
        <button className="btn-primary shrink-0">
          Run query
          <span className="kbd !border-gunmetal-900 !bg-gunmetal-900/80 !text-gunmetal-950">
            ↵
          </span>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="label-eyebrow mr-1">Sources</span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] transition ${
              activeFilter === f.id
                ? "border-cyan-500/50 bg-cyan-500/[0.12] text-cyan-200"
                : "border-white/[0.08] bg-white/[0.02] text-ink-400 hover:border-cyan-500/30 hover:text-cyan-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="mx-3 h-5 w-px bg-white/10" />
        <span className="label-eyebrow mr-1">Aircraft</span>
        <select
          value={activeAircraft}
          onChange={(e) => setActiveAircraft(e.target.value)}
          className="rounded-md border border-white/[0.08] bg-gunmetal-900 px-3 py-1.5 text-[11.5px] text-ink-200 focus:border-cyan-500/40 focus:outline-none"
        >
          {AIRCRAFT.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
