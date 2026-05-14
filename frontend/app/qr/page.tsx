"use client";

/**
 * /qr — Printable QR for the merchant's project.
 *
 * Linked from the merchant onboarding checklist (step 4 of the
 * QA's 5-step plan: "Print your QR"). Renders the merchant's
 * project URL as a high-resolution QR via api.qrserver.com
 * (no JS dependency added — single <img> tag).
 *
 * Auth gating:
 *   - Signed out → sign-in CTA
 *   - Signed in, no project → routes back to /merchant
 *   - Signed in with project → QR + print button
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { API_BASE } from "../../lib/apiBase";

interface ProjectSummary {
  id: string;
  slug?: string | null;
  title?: string | null;
}

export default function QrPage() {
  const { user, loading: authLoading, login } = useAuth();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Mark "Print your QR" complete on the merchant checklist.
  // Visiting /qr is the best signal we have that the merchant has
  // seen + can print their code.
  useEffect(() => {
    try {
      window.sessionStorage.setItem("dum-qr-seen", "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    // Wait for Privy/Auth hydration before deciding whether to
    // show the signed-out CTA — otherwise the page flashes the
    // sign-in screen on hard refresh for already-logged-in
    // merchants (mirror of QA T4 fix on /install).
    if (authLoading) return;
    if (!user?.privyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user.privyId)}`,
        );
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const list = (await res.json()) as ProjectSummary[];
        if (cancelled) return;
        setProject(Array.isArray(list) && list.length > 0 ? list[0] : null);
      } catch {
        // soft fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.privyId]);

  const projectUrl = useMemo(() => {
    if (!project) return "";
    const slug = project.slug || project.id;
    const origin =
      typeof window !== "undefined" && window.location.origin.includes("localhost")
        ? window.location.origin
        : "https://www.dum.club";
    return `${origin}/project/${slug}`;
  }, [project]);

  const qrSrc = projectUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=12&data=${encodeURIComponent(projectUrl)}`
    : "";

  if (authLoading || loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12" aria-busy="true">
        <div className="mb-3 h-8 w-3/4 animate-pulse rounded bg-surface-muted" />
        <div className="mb-8 h-4 w-full animate-pulse rounded bg-surface-muted" />
        <div className="h-80 animate-pulse rounded-2xl bg-surface-card" />
      </main>
    );
  }

  if (!user?.privyId) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold text-primary">Print your QR</h1>
        <p className="mb-6 text-secondary">Sign in to grab your QR code.</p>
        <button
          type="button"
          onClick={login}
          className="rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Sign in
        </button>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold text-primary">Print your QR</h1>
        <p className="mb-6 text-secondary">
          You'll need a project first. Set one up and come back here.
        </p>
        <Link
          href="/merchant"
          className="rounded-xl bg-brand-teal px-5 py-3 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Set up my project
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-3 text-3xl font-bold text-primary">Print your QR</h1>
      <p className="mb-8 text-secondary">
        Print this code and put it at your point of sale. Customers scan with
        their phone camera to land on your storefront, watch you live, and buy.
      </p>

      <section className="mb-6 rounded-2xl border border-default bg-surface-card p-6 text-center print:border-0 print:bg-white print:p-0">
        <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.24em] text-secondary print:hidden">
          {project.title || project.slug || project.id}
        </div>
        <div className="mx-auto inline-block rounded-2xl bg-white p-3 print:rounded-none print:p-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            width={480}
            height={480}
            alt={`QR code linking to ${projectUrl}`}
            className="mx-auto block h-auto w-full max-w-[480px]"
          />
        </div>
        <div className="mt-4 break-all font-mono text-[11px] text-muted print:text-black">
          {projectUrl}
        </div>
      </section>

      <div className="flex flex-wrap gap-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-teal px-4 py-2.5 text-sm font-bold text-black transition hover:bg-brand-teal-hover"
        >
          Print
        </button>
        <a
          href={qrSrc}
          download={`dum-club-qr-${project.slug || project.id}.png`}
          className="inline-flex items-center gap-2 rounded-xl border border-default px-4 py-2.5 text-sm font-bold text-primary transition hover:border-brand-teal/60"
        >
          Download PNG
        </a>
        <Link
          href="/install"
          className="inline-flex items-center gap-2 rounded-xl border border-default px-4 py-2.5 text-sm font-bold text-primary transition hover:border-brand-teal/60"
        >
          Get my snippet
        </Link>
      </div>
    </main>
  );
}
