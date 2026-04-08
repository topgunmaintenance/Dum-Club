import Link from "next/link";

import { TerminalMock } from "./TerminalMock";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-white/[0.06]">
      <div className="absolute inset-0 grid-backdrop opacity-[0.35]" />
      <div className="absolute inset-0 radial-spotlight" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent" />

      <div className="relative mx-auto flex max-w-6xl flex-col gap-14 px-6 pt-20 pb-24 md:flex-row md:items-center md:gap-16 md:pt-28 md:pb-32">
        <div className="flex-1">
          <div className="pill-cyan mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
            AI Maintenance Intelligence · Aviation
          </div>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-ink-100 md:text-[64px]">
            Search your entire
            <br />
            <span className="bg-gradient-to-r from-cyan-200 via-cyan-100 to-white bg-clip-text text-transparent">
              maintenance stack
            </span>
            <br />
            in seconds.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-300 md:text-[16px]">
            Topgun AI ingests aircraft manuals, maintenance records, parts
            catalogs, and scanned paperwork — then answers your questions
            with cited evidence, extracted entities, and a confidence
            signal you can actually trust.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/dashboard" className="btn-primary">
              Open workspace
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/query" className="btn-ghost">
              See a live query
            </Link>
          </div>

          <dl className="mt-12 grid max-w-xl grid-cols-3 gap-6 border-t border-white/[0.06] pt-8">
            <div>
              <dt className="stat-label">Retrieval lanes</dt>
              <dd className="stat-value">4</dd>
              <p className="mt-1 text-[11px] text-ink-400">
                Manuals · history · parts · patterns
              </p>
            </div>
            <div>
              <dt className="stat-label">Hallucinations</dt>
              <dd className="stat-value">0</dd>
              <p className="mt-1 text-[11px] text-ink-400">
                Refuses to answer without evidence
              </p>
            </div>
            <div>
              <dt className="stat-label">Audit trail</dt>
              <dd className="stat-value">100%</dd>
              <p className="mt-1 text-[11px] text-ink-400">
                Every query, ingest, and edit logged
              </p>
            </div>
          </dl>
        </div>

        <div className="flex-1 md:max-w-[580px]">
          <TerminalMock />
        </div>
      </div>
    </section>
  );
}
