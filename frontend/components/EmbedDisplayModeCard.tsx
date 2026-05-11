"use client";

/**
 * EmbedDisplayModeCard — Loom-style "How does DUM Club appear on
 * your website?" merchant setting.
 *
 * Three large cards (Bubble / Full Sale / Automatic) that write
 * projects.embed_display_mode via PATCH /api/projects/{id}.
 *
 * This is the OUTER embed chrome behaviour controlled by the
 * merchant for their own website. Distinct from the inner Pop-In
 * Seller greeting bubble (PopInSettings.tsx) which lives inside
 * the iframe.
 *
 * Default mode is "automatic" — the value enforced by the DB
 * CHECK constraint in migration 040 and the backend allow-list
 * in projects.py::_EMBED_DISPLAY_MODES.
 */

import { useEffect, useState } from "react";
import { CircleDot, Maximize2, Sparkles } from "lucide-react";

import { API_BASE } from "../lib/apiBase";

type Mode = "bubble" | "full" | "automatic";

type MerchantProject = {
  id: string;
  embed_display_mode?: Mode | string | null;
};

type Props = {
  project: MerchantProject;
  getToken: () => Promise<string | null>;
  /** Optional callback fired after a successful save (e.g. so the
   *  dashboard can refresh its in-memory project list). */
  onSaved?: (mode: Mode) => void;
};

type Card = {
  value: Mode;
  icon: typeof CircleDot;
  title: string;
  description: string;
  bestFor: string;
  recommended?: boolean;
};

const CARDS: Card[] = [
  {
    value: "bubble",
    icon: CircleDot,
    title: "Bubble",
    description:
      "A small floating button on your website. Visitors tap it to open your live sale, offers, and chat.",
    bestFor: "Available on every page without taking over your layout.",
  },
  {
    value: "full",
    icon: Maximize2,
    title: "Full Sale",
    description:
      "The complete live storefront drops right into your page. Live video, offers, chat, and checkout in one block.",
    bestFor: "Dedicated pages like Live Deals, Weekly Specials, or Shop Live.",
  },
  {
    value: "automatic",
    icon: Sparkles,
    title: "Automatic",
    description:
      "DUM Club picks the right mode for you. The bubble grabs attention when you go live; the storefront stays inline the rest of the time.",
    bestFor: "Most merchants.",
    recommended: true,
  },
];

export function EmbedDisplayModeCard({ project, getToken, onSaved }: Props) {
  const initial = ((): Mode => {
    const m = (project.embed_display_mode || "").toString().toLowerCase();
    if (m === "bubble" || m === "full" || m === "automatic") return m;
    return "automatic";
  })();

  const [mode, setMode] = useState<Mode>(initial);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    { kind: "ok" | "error"; message: string } | null
  >(null);
  const dirty = mode !== initial;

  // Auto-dismiss the status banner after a few seconds.
  useEffect(() => {
    if (!saveStatus) return;
    const t = window.setTimeout(() => setSaveStatus(null), 3500);
    return () => window.clearTimeout(t);
  }, [saveStatus]);

  async function activate() {
    if (saving) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/projects/${project.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ embed_display_mode: mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || `Save failed (${res.status})`);
      }
      setSaveStatus({ kind: "ok", message: "DUM Live activated." });
      onSaved?.(mode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveStatus({ kind: "error", message: msg });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="embed-display-mode-heading"
      className="mt-8 rounded-3xl border border-default bg-surface-card p-6 shadow-sm sm:p-8"
    >
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.28em] text-brand-teal">
        Display Mode · Step 1 of 5
      </div>
      <h2
        id="embed-display-mode-heading"
        className="text-2xl font-extrabold tracking-tight text-brand-navy sm:text-3xl"
      >
        How should DUM Club appear on your website?
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-secondary sm:text-base">
        Pick the layout that fits your site. You can change this any time.
      </p>

      <div
        role="radiogroup"
        aria-labelledby="embed-display-mode-heading"
        className="mt-6 grid gap-4 md:grid-cols-3"
      >
        {CARDS.map(({ value, icon: Icon, title, description, bestFor, recommended }) => {
          const selected = mode === value;
          return (
            <label
              key={value}
              className={`group relative flex cursor-pointer flex-col rounded-2xl border bg-surface-page p-5 transition shadow-sm hover:shadow-md ${
                selected
                  ? "border-brand-teal ring-2 ring-brand-teal/40"
                  : "border-default hover:border-strong"
              }`}
            >
              <input
                type="radio"
                name="embed-display-mode"
                value={value}
                checked={selected}
                onChange={() => setMode(value)}
                className="sr-only"
                aria-label={title}
              />
              {recommended && (
                <span className="absolute -top-2 right-4 rounded-full bg-brand-teal px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-brand-navy shadow-sm">
                  Recommended
                </span>
              )}
              <span
                className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border transition ${
                  selected
                    ? "border-brand-teal bg-brand-teal-soft text-brand-teal"
                    : "border-default bg-surface-card text-secondary group-hover:text-primary"
                }`}
                aria-hidden="true"
              >
                <Icon className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <span className="text-base font-extrabold text-brand-navy">{title}</span>
              <span className="mt-1 text-[13px] leading-relaxed text-secondary">
                {description}
              </span>
              <span className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-teal">
                Best for
              </span>
              <span className="mt-0.5 text-[12px] leading-relaxed text-primary">
                {bestFor}
              </span>
              <span
                className={`mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                  selected ? "text-brand-teal" : "text-muted"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full border ${
                    selected
                      ? "border-brand-teal bg-brand-teal"
                      : "border-default bg-surface-card"
                  }`}
                />
                {selected ? "Selected" : "Tap to select"}
              </span>
            </label>
          );
        })}
      </div>

      <div className="mt-7 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] leading-relaxed text-muted sm:max-w-md">
          Changes take effect on your next page load. Existing visitors keep
          their current view until they refresh.
        </p>
        <button
          type="button"
          onClick={activate}
          disabled={saving || !dirty}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal px-6 text-sm font-bold uppercase tracking-[0.12em] text-brand-navy transition-colors hover:bg-brand-teal-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Activating…" : dirty ? "Activate DUM Live" : "Saved"}
        </button>
      </div>
      {saveStatus ? (
        <p
          role="status"
          className={`mt-3 text-sm font-medium ${
            saveStatus.kind === "ok" ? "text-brand-teal" : "text-state-live"
          }`}
        >
          {saveStatus.message}
        </p>
      ) : null}
    </section>
  );
}
