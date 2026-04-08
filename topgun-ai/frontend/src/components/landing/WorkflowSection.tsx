const STEPS = [
  {
    n: "01",
    label: "Ingest",
    title: "Drop in your stack",
    body: "AMMs, IPCs, work orders, logbooks, bulletins, parts catalogs, and scans. PDFs, images, or bulk ZIPs.",
  },
  {
    n: "02",
    label: "Extract",
    title: "Pipeline does the work",
    body: "PyMuPDF + OCR fallback → classifier → field extractor → chunker → embedder → indexer. Every chunk keeps its page anchor.",
  },
  {
    n: "03",
    label: "Ask",
    title: "Query in plain English",
    body: "Four lanes run in parallel and fuse into a single answer. Filter by aircraft, ATA chapter, source, or document type.",
  },
  {
    n: "04",
    label: "Trust",
    title: "Cited, scored, audited",
    body: "Every answer carries citations, extracted entities, and a confidence signal. Nothing leaves the system uncited.",
  },
];

export function WorkflowSection() {
  return (
    <section className="relative border-b border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-6 py-24 md:py-28">
        <div className="mb-16 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="pill mb-4">Workflow</div>
            <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.015em] text-ink-100 md:text-[44px]">
              From documents to decisions,
              <br />
              in four steps.
            </h2>
          </div>
          <p className="max-w-md text-[13.5px] leading-relaxed text-ink-300">
            Designed for hangar realities: phone-friendly, low-bandwidth
            tolerant, and never afraid to say "no evidence found."
          </p>
        </div>

        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="panel relative p-6 transition hover:border-cyan-500/30"
            >
              <div className="mb-5 flex items-center justify-between">
                <span className="pill-cyan">{s.label}</span>
                <span className="font-mono text-[11px] text-ink-500">
                  {s.n}
                </span>
              </div>
              <h3 className="text-[14px] font-semibold text-ink-100">
                {s.title}
              </h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
