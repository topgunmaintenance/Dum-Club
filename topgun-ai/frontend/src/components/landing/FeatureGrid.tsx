const FEATURES = [
  {
    title: "Manuals + records, one query",
    body: "AMMs, IPCs, service bulletins, work orders, logbooks, and shop reports — searched together. No more PDF tab-hunting.",
    glyph: "▤",
  },
  {
    title: "Source-cited, chunk-level",
    body: "Every answer carries document, page, snippet, score, and lane. Open the Source Drawer to verify in one click.",
    glyph: "❑",
  },
  {
    title: "4-lane retrieval",
    body: "Manual, history, parts, and pattern lanes run in parallel and merge with rank fusion tuned per question type.",
    glyph: "⌬",
  },
  {
    title: "Confidence you can act on",
    body: "Topgun AI never hides a weak answer. The confidence badge tells you exactly how much evidence is behind it.",
    glyph: "△",
  },
  {
    title: "Recurring fault detection",
    body: "Cluster write-ups across the fleet to spot the next bleed-air overtemp before it grounds another aircraft.",
    glyph: "◇",
  },
  {
    title: "Audit-grade by design",
    body: "Every query, ingest, and correction is logged with actor, source, and timestamp. Built for regulated operators.",
    glyph: "⌗",
  },
];

export function FeatureGrid() {
  return (
    <section className="border-b border-white/[0.06] bg-gunmetal-950">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
        <div className="mb-16 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="pill mb-4">Capabilities</div>
            <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.015em] text-ink-100 md:text-[44px]">
              Mission-critical maintenance,
              <br />
              not casual chat.
            </h2>
          </div>
          <p className="max-w-md text-[13.5px] leading-relaxed text-ink-300">
            Topgun AI is a structured intelligence panel for mechanics,
            planners, and inspectors. Every feature serves the audit-grade
            decisions your team makes every shift.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="panel group relative p-6 transition duration-200 hover:border-cyan-500/30 hover:bg-gunmetal-800/80"
            >
              <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/25 bg-cyan-500/[0.08] text-cyan-300">
                {f.glyph}
              </div>
              <h3 className="text-[15px] font-semibold tracking-tight text-ink-100">
                {f.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
                {f.body}
              </p>
              <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent opacity-0 transition group-hover:opacity-100" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
