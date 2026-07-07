"use client";

/**
 * FoundingModal — first-visit merchant-recruitment "pop".
 *
 * Shows once per visitor on the homepage ("/") only, after a short delay,
 * leading with the always-true fee hook (Whatnot up to 8% vs DUM Club 1.5%) and the
 * canonical founding offer, with a "Claim Your Founding Spot" CTA to /merchant.
 *
 * Doctrine: canonical founding copy only (CLAUDE.md §3) — 30 days free + lock
 * in founding pricing for life; NEVER a live "X of 100" counter; "Whatnot takes
 * 8%" is the competitor's top published fee (their site says ≤8%). Dismissible (X / backdrop / Esc /
 * "Maybe later"); the localStorage flag stops it nagging on return visits.
 * Self-gates so the giant homepage file needs no edit — mounted once in the
 * root layout.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

const SEEN_KEY = "dumclub_founding_modal_seen_v1";

export function FoundingModal() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Homepage only, once per visitor, after a short delay so it never slams
  // the page on load.
  useEffect(() => {
    if (pathname !== "/") return;
    let seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === "1"; } catch {}
    if (seen) return;
    const t = setTimeout(() => setOpen(true), 1400);
    return () => clearTimeout(t);
  }, [pathname]);

  function dismiss() {
    setOpen(false);
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
  }

  // Esc to close while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") dismiss(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Founding merchant offer"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-default bg-surface-card shadow-2xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-secondary transition hover:bg-surface-muted hover:text-primary"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke="currentColor" strokeLinecap="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="p-6 sm:p-7">
          <span className="inline-block rounded-full bg-brand-teal-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-navy">
            Limited · Founding 100
          </span>

          <h2 className="mt-3 text-xl font-bold leading-snug text-primary sm:text-2xl">
            Join the first 100 merchants.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-secondary">
            Get 30 days free and lock in founding pricing for life. Flat monthly
            subscription + 1.5% sales fee. Industry-low. Keep more of every sale.
          </p>

          {/* Always-true fee hook — competitor's published fee vs ours. */}
          <div className="mt-4 flex items-stretch gap-2 rounded-xl border border-default bg-surface-muted p-3">
            <div className="flex-1 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">Whatnot</div>
              <div className="text-xl font-extrabold text-primary">up to 8%</div>
            </div>
            <div className="flex items-center text-xs font-bold text-secondary">vs</div>
            <div className="flex-1 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-secondary">DUM Club</div>
              <div className="text-xl font-extrabold text-brand-teal">1.5%</div>
            </div>
          </div>

          <Link
            href="/merchant"
            onClick={dismiss}
            className="mt-5 block w-full rounded-xl bg-brand-teal py-3 text-center text-sm font-bold text-black transition hover:bg-brand-teal-hover hover:text-white"
          >
            Claim Your Founding Spot
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="mt-2 block w-full text-center text-xs font-medium text-secondary transition hover:text-primary"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
