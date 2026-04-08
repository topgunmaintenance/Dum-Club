"use client";

import { useState } from "react";

const TYPES = [
  "All types",
  "AMM",
  "IPC",
  "SB",
  "WORK_ORDER",
  "LOGBOOK",
  "TROUBLESHOOTING",
  "PARTS_CATALOG",
  "INSPECTION_PROGRAM",
];
const AIRCRAFT = [
  "All aircraft",
  "Citation XLS",
  "King Air 350",
  "Gulfstream G200",
  "Learjet 60",
];

export function LibraryFilters() {
  const [type, setType] = useState(TYPES[0]);
  const [aircraft, setAircraft] = useState(AIRCRAFT[0]);
  const [q, setQ] = useState("");

  return (
    <div className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4">
      <div className="flex flex-1 items-center gap-3 rounded-lg border border-white/10 bg-gunmetal-900/70 px-3 py-2 text-[13px] focus-within:border-cyan-500/50 focus-within:shadow-glow">
        <span className="font-mono text-cyan-400">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title, summary, tag, or aircraft"
          className="w-full bg-transparent text-ink-100 placeholder:text-ink-400 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-3">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border border-white/10 bg-gunmetal-900 px-3 py-2 text-[12px] text-ink-200 focus:border-cyan-500/40 focus:outline-none"
        >
          {TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          value={aircraft}
          onChange={(e) => setAircraft(e.target.value)}
          className="rounded-md border border-white/10 bg-gunmetal-900 px-3 py-2 text-[12px] text-ink-200 focus:border-cyan-500/40 focus:outline-none"
        >
          {AIRCRAFT.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <button className="btn-ghost">Upload</button>
      </div>
    </div>
  );
}
