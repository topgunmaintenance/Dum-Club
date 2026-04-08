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
    <section className="panel relative overflow-hidden p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
      <label className="stat-label">Ask Topgun AI</label>
      <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-gunmetal-900/80 px-4 py-3 transition focus-within:border-cyan-500/60 focus-within:shadow-glow">
        <span className="font-mono text-cyan-400">⌕</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Describe a fault, ask for a procedure, or look up a part…"
          className="w-full bg-transparent text-base text-ink-100 placeholder:text-ink-400 focus:outline-none"
        />
        <button className="btn-primary shrink-0">
          Run query
          <span aria-hidden="true">↵</span>
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="stat-label mr-2">Filter</span>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFilter(f.id)}
            className={`pill transition ${
              activeFilter === f.id
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                : "hover:border-cyan-500/30 hover:text-cyan-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="mx-3 h-5 w-px bg-white/10" />
        <span className="stat-label mr-2">Aircraft</span>
        <select
          value={activeAircraft}
          onChange={(e) => setActiveAircraft(e.target.value)}
          className="rounded-md border border-white/10 bg-gunmetal-900 px-2 py-1 text-[12px] text-ink-200 focus:border-cyan-500/40 focus:outline-none"
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
