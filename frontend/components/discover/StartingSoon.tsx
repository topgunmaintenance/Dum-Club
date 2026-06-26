"use client";

/**
 * StartingSoon — "The Club" home: scheduled shows as a vertical list with an
 * inline Remind button (the mock's "Starting soon" rail).
 *
 * Each row: monogram/logo thumbnail, show title, "in 25 min · @seller", and a
 * Remind button wired to the existing live-reminders API (POST
 * /api/projects/{id}/live-reminders). Signed-out taps open login; signed-in
 * taps register the reminder and flip to "Reminded". Best-effort — a failed
 * register reverts so the buyer can retry.
 *
 * Real data only: future projects.scheduled_live_at, soonest first; renders
 * nothing when nothing is scheduled.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "../../lib/discover/types";
import { cleanLogoUrl } from "../../lib/imageSrc";
import { useAuth } from "../../lib/auth/AuthContext";
import { API_BASE } from "../../lib/apiBase";

const MAX_ROWS = 8;

function scheduledMs(p: Project): number {
  const raw = p.scheduled_live_at;
  if (!raw) return NaN;
  const iso = raw
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(iso);
}

function whenLabel(startMs: number, nowMs: number): string {
  const diff = startMs - nowMs;
  const mins = Math.floor(diff / 60_000);
  if (mins <= 1) return "starting soon";
  if (mins < 60) return `in ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 12) {
    const d = new Date(startMs);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const d = new Date(startMs);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function RemindButton({ projectId }: { projectId: string }) {
  const { user, login } = useAuth();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === "busy" || state === "done") return;
    if (!user) { login(); return; }
    if (!user.email) { setState("done"); return; }
    setState("busy");
    try {
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/live-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      setState(res.ok ? "done" : "idle");
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "busy"}
      aria-pressed={state === "done"}
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
        state === "done"
          ? "border-mint-text bg-transparent text-mint-text"
          : "border-default bg-surface-card text-primary hover:border-strong"
      }`}
    >
      <span aria-hidden="true">{state === "done" ? "✓" : "🔔"}</span>
      {state === "done" ? "Reminded" : "Remind"}
    </button>
  );
}

export function StartingSoon({ projects }: { projects: Project[] }) {
  const [now, setNow] = useState(() => Date.now());

  const upcoming = projects
    .filter((p) => p.is_live !== true)
    .map((p) => ({ p, ms: scheduledMs(p) }))
    .filter((x) => Number.isFinite(x.ms) && x.ms > now)
    .sort((a, b) => a.ms - b.ms)
    .slice(0, MAX_ROWS);

  useEffect(() => {
    if (upcoming.length === 0) return;
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, [upcoming.length]);

  if (upcoming.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.15em] text-primary">Starting soon</h2>
      <div className="divide-y divide-[var(--border-default)] overflow-hidden rounded-2xl border border-default bg-surface-card">
        {upcoming.map(({ p, ms }) => {
          const businessName = p.title || p.name || "Untitled";
          const showTitle = p.description?.trim() || businessName;
          const handle = p.slug ? `@${p.slug}` : null;
          const logo = cleanLogoUrl(p.business_profile?.cover_image_url) || cleanLogoUrl(p.business_profile?.logo_url);
          const monogram = (businessName.trim().charAt(0) || "•").toUpperCase();
          return (
            <div key={p.id} className="flex items-center gap-3 p-3">
              <Link href={`/project/${p.slug || p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-default bg-brand-teal-soft">
                  {logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logo} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-base font-extrabold text-mint-text">{monogram}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-primary">{showTitle}</span>
                  <span className="block truncate text-[11px] text-secondary">
                    {whenLabel(ms, now)}
                    {handle && ` · ${handle}`}
                  </span>
                </span>
              </Link>
              <RemindButton projectId={p.id} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
