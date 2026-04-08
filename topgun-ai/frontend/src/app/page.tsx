import Link from "next/link";

import { FeatureGrid } from "@/components/landing/FeatureGrid";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { WorkflowSection } from "@/components/landing/WorkflowSection";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gunmetal-950">
      <TopNav />
      <Hero />
      <FeatureGrid />
      <WorkflowSection />
      <CtaStrip />
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-gunmetal-950/80 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 text-gunmetal-950 shadow-glow">
            <span className="font-mono text-sm font-bold">T</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-ink-100">Topgun AI</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-ink-400">
              Maintenance Intelligence
            </div>
          </div>
        </Link>

        <div className="hidden items-center gap-7 text-[12px] text-ink-300 md:flex">
          <Link href="/query" className="hover:text-cyan-300">
            Query Workspace
          </Link>
          <Link href="/library" className="hover:text-cyan-300">
            Library
          </Link>
          <Link href="/insights" className="hover:text-cyan-300">
            Insights
          </Link>
          <Link href="/admin" className="hover:text-cyan-300">
            System
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="btn-primary">
            Open dashboard
          </Link>
        </div>
      </nav>
    </header>
  );
}

function CtaStrip() {
  return (
    <section className="border-b border-white/5 bg-gradient-to-b from-gunmetal-950 to-gunmetal-900">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-20 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h3 className="text-2xl font-semibold tracking-tight text-ink-100 md:text-3xl">
            Turn maintenance paperwork into operational intelligence.
          </h3>
          <p className="mt-3 text-ink-300">
            Spin up Topgun AI in minutes. Bring your own manuals and start
            asking questions with cited evidence on the very first day.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="btn-primary">
            Launch dashboard
          </Link>
          <Link href="/query" className="btn-ghost">
            See a query
          </Link>
        </div>
      </div>
    </section>
  );
}
