export function TerminalMock() {
  return (
    <div className="panel relative overflow-hidden p-0 shadow-glow">
      <div className="flex items-center gap-2 border-b border-white/5 bg-gunmetal-900/80 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
        <div className="ml-3 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-400">
          topgun://query — citation_xls / ata_29
        </div>
      </div>

      <div className="p-5 font-mono text-[12.5px] leading-relaxed text-ink-200">
        <div className="text-cyan-300">
          <span className="text-ink-500">›</span> ask "hydraulic pressure
          fluctuation citation xls"
        </div>

        <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-wider">
            <span className="text-cyan-300">Executive answer</span>
            <span className="pill-cyan">confidence · high · 0.86</span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-100">
            Likely causes: engine-driven pump wear, reservoir aeration,
            pressure regulator drift, or a leaking priority valve. Start
            with reservoir level + aeration check, then a pump case-drain
            flow test before condemning the regulator.
          </p>
        </div>

        <div className="mt-4 grid gap-2">
          <CitationLine
            tag="AMM 29-10-00"
            title="Citation XLS AMM — Ch. 29 Hydraulic Power"
            page={14}
            score={0.92}
          />
          <CitationLine
            tag="AMM 29-12-02"
            title="Citation XLS AMM — Pressure regulator"
            page={27}
            score={0.88}
          />
          <CitationLine
            tag="WO-2026-0418"
            title="Work Order N123XL"
            page={3}
            score={0.81}
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-2 text-[10px]">
          <span className="pill">aircraft · Citation XLS</span>
          <span className="pill">ata · 29</span>
          <span className="pill">tail · N123XL</span>
          <span className="pill">part · 3214091-01</span>
        </div>
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
    <div className="flex items-center justify-between rounded-lg border border-white/5 bg-gunmetal-900/70 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="pill-cyan whitespace-nowrap">{tag}</span>
        <span className="truncate text-[12px] text-ink-200">{title}</span>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-3 text-[11px] text-ink-400">
        <span>p. {page}</span>
        <span className="font-mono text-cyan-300">{score.toFixed(2)}</span>
      </div>
    </div>
  );
}
