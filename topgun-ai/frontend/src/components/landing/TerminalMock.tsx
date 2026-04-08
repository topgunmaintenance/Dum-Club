export function TerminalMock() {
  return (
    <div className="panel-accent relative overflow-hidden p-0 shadow-glow">
      {/* Chrome */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-gunmetal-900/80 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
        <div className="ml-3 flex-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-400">
          topgun://query · citation_xls · ata_29
        </div>
        <span className="pill-emerald">live</span>
      </div>

      {/* Body */}
      <div className="p-5 font-mono text-[12px] leading-relaxed text-ink-200">
        {/* Prompt */}
        <div className="flex items-start gap-2">
          <span className="text-ink-500">›</span>
          <span className="text-cyan-300">
            ask "hydraulic pressure fluctuation citation xls"
          </span>
        </div>

        {/* Answer card */}
        <div className="mt-4 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.04] p-4">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em]">
            <span className="text-cyan-300">Executive answer</span>
            <span className="pill-cyan">confidence · high · 0.86</span>
          </div>
          <p className="mt-3 font-sans text-[13px] leading-relaxed text-ink-100">
            Likely causes: engine-driven pump wear, reservoir aeration,
            pressure regulator drift, or a leaking priority valve. Start
            with reservoir level + aeration check, then a pump case-drain
            flow test before condemning the regulator.
          </p>
        </div>

        {/* Lane contribution */}
        <div className="mt-4 rounded-lg border border-white/[0.06] bg-gunmetal-900/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-eyebrow">Lane contribution</span>
            <span className="mono-meta">RRF · weighted</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <LaneBar label="manual" pct={62} />
            <LaneBar label="history" pct={24} />
            <LaneBar label="parts" pct={9} />
            <LaneBar label="pattern" pct={5} />
          </div>
        </div>

        {/* Citations */}
        <div className="mt-4 grid gap-2">
          <CitationLine
            tag="AMM 29-10"
            title="Citation XLS AMM — Ch. 29 Hydraulic Power"
            page={14}
            score={0.92}
          />
          <CitationLine
            tag="AMM 29-12"
            title="Citation XLS AMM — Pressure regulator"
            page={27}
            score={0.88}
          />
          <CitationLine
            tag="WO-0418"
            title="Work Order N123XL"
            page={3}
            score={0.81}
          />
        </div>

        {/* Entities */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          <span className="pill">aircraft · Citation XLS</span>
          <span className="pill">ata · 29</span>
          <span className="pill">tail · N123XL</span>
          <span className="pill">part · 3214091-01</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/[0.06] bg-gunmetal-900/60 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-400">
        <span>184 ms</span>
        <span className="text-cyan-300">source-first</span>
        <span>3 citations · 4 entities</span>
      </div>
    </div>
  );
}

function LaneBar({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-ink-400">{label}</span>
        <span className="font-mono text-cyan-300">{pct}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CitationLine({
  tag,
  title,
  page,
  score,
}: {
  tag: string;
  title: string;
  page: number;
  score: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-gunmetal-900/70 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="pill-cyan whitespace-nowrap">{tag}</span>
        <span className="truncate text-[11.5px] text-ink-200">{title}</span>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-3 text-[10px] text-ink-400">
        <span className="mono-meta">p.{page}</span>
        <span className="font-mono text-cyan-300">{score.toFixed(2)}</span>
      </div>
    </div>
  );
}
