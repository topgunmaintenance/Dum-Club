const STEPS = [
  {
    n: "01",
    label: "Upload",
    title: "Drop in your stack",
    body: "AMMs, IPCs, work orders, logbooks, bulletins, parts catalogs, and scanned sign-offs. PDFs, images, or ZIPs.",
  },
  {
    n: "02",
    label: "Ingest",
    title: "Pipeline does the work",
    body: "PyMuPDF + OCR fallback → classifier → field extractor → chunker → embedder → indexer. Every chunk gets a page anchor.",
  },
  {
    n: "03",
    label: "Ask",
    title: "Query in plain English",
    body: "Topgun AI runs four lanes in parallel and fuses the results. Filter by aircraft, ATA, source, or document type.",
  },
  {
    n: "04",
    label: "Trust",
    title: "Cited, scored, audited",
    body: "Every answer carries a confidence badge, citations, extracted entities, and a full audit trail.",
  },
];

export function WorkflowSection() {
  return (
    <section className="relative border-b border-white/5">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-14 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <div className="pill mb-4">Workflow</div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink-100 md:text-4xl">
              From documents to decisions, in four steps.
            </h2>
          </div>
          <p className="max-w-md text-[13px] text-ink-300">
            Designed for hangar realities: phone-friendly, low-bandwidth
            tolerant, and never afraid to say "no evidence found."
          </p>
        </div>

        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="panel relative p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-300">
                  {s.label}
                </span>
                <span className="font-mono text-[11px] text-ink-500">{s.n}</span>
              </div>
              <h3 className="text-sm font-semibold text-ink-100">{s.title}</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-300">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
