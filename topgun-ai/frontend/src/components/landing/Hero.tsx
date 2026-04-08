import Link from "next/link";

import { TerminalMock } from "./TerminalMock";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-white/5">
      <div className="absolute inset-0 bg-grid-faint bg-grid-faint opacity-[0.35]" />
      <div className="absolute inset-0 bg-radial-spotlight" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-6 pt-20 pb-24 md:flex-row md:items-center md:gap-16 md:pt-28 md:pb-32">
        <div className="flex-1">
          <div className="pill-cyan mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            AI Maintenance Intelligence for Aviation Teams
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink-100 md:text-6xl">
            Search your maintenance
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-cyan-200 to-white bg-clip-text text-transparent">
              intelligence stack in seconds.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-300 md:text-lg">
            Topgun AI ingests aircraft manuals, maintenance records, parts
            catalogs, and scanned paperwork — then answers your questions
            with cited evidence, extracted entities, and a confidence
            signal you can actually trust.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="btn-primary">
              Launch the dashboard
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/query" className="btn-ghost">
              Try the query workspace
            </Link>
          </div>

          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/5 pt-8">
            <div>
              <dt className="stat-label">Lanes</dt>
              <dd className="stat-value">4</dd>
              <p className="mt-1 text-[11px] text-ink-400">
                Manuals · history · parts · patterns
              </p>
            </div>
            <div>
              <dt className="stat-label">Aircraft types</dt>
              <dd className="stat-value">∞</dd>
              <p className="mt-1 text-[11px] text-ink-400">
                Operator-defined fleet
              </p>
            </div>
            <div>
              <dt className="stat-label">Hallucinations</dt>
              <dd className="stat-value">0</dd>
              <p className="mt-1 text-[11px] text-ink-400">
                Source-first by design
              </p>
            </div>
          </dl>
        </div>

        <div className="flex-1">
          <TerminalMock />
        </div>
      </div>
    </section>
  );
}
