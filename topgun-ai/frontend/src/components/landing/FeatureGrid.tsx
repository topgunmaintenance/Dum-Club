const FEATURES = [
  {
    title: "Manuals + records, one query",
    body: "Search AMMs, IPCs, service bulletins, work orders, logbooks, and shop reports together. No more switching between PDFs.",
    glyph: "▤",
  },
  {
    title: "Source-cited answers",
    body: "Every answer carries chunk-level provenance: document, page, snippet, score, and lane. The Source Drawer is one click away.",
    glyph: "❑",
  },
  {
    title: "4-lane retrieval",
    body: "Manual, history, parts, and pattern lanes run in parallel and merge with rank fusion tuned per question type.",
    glyph: "⌬",
  },
  {
    title: "Confidence on every reply",
    body: "Topgun AI never hides a low-confidence answer. The badge tells you when there is not enough evidence to commit.",
    glyph: "△",
  },
  {
    title: "Recurring fault detection",
    body: "Cluster write-ups across the fleet to spot the next bleed-air overtemp before it grounds another aircraft.",
    glyph: "◇",
  },
  {
    title: "Audit-ready by design",
    body: "Every query, ingestion, and edit is logged with the actor, the source, and the time. Built for regulated operators.",
    glyph: "⌗",
  },
];

export function FeatureGrid() {
  return (
    <section className="border-b border-white/5 bg-gunmetal-950">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-14 max-w-2xl">
          <div className="pill mb-4">Capabilities</div>
          <h2 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
            Built for mission-critical maintenance,
            <br />
            not casual chat.
          </h2>
          <p className="mt-4 text-ink-300">
            Topgun AI is a structured intelligence panel for mechanics,
            planners, and inspectors. Every feature serves the
            audit-grade decisions your team makes every shift.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="panel group relative p-6 transition hover:border-cyan-500/30"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                {f.glyph}
              </div>
              <h3 className="text-base font-semibold text-ink-100">{f.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-300">
                {f.body}
              </p>
              <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent opacity-0 transition group-hover:opacity-100" />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
