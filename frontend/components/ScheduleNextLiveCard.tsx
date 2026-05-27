"use client";

/**
 * ScheduleNextLiveCard — lightweight merchant input for the
 * "Next scheduled live" timestamp. Drives the storefront's
 * "Going live <day> at <time>" banner.
 *
 * The whole feature is a single TIMESTAMPTZ column on projects
 * (migration 064). This card persists it via the existing
 * PATCH /api/projects/{id} endpoint, the same call EmbedDisplay-
 * ModeCard and PopInSettings already use.
 *
 * No new state machines. No new endpoints. No new dependencies.
 */

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type Props = {
  project: {
    id: string;
    scheduled_live_at: string | null | undefined;
  };
  getToken: () => Promise<string | null | undefined>;
  onSaved: () => void;
};

// Convert an ISO 8601 string (UTC) to the local-time value the
// HTML `<input type="datetime-local">` expects (`YYYY-MM-DDTHH:mm`).
// Returns "" for null/undefined input.
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => n.toString().padStart(2, "0");
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  } catch {
    return "";
  }
}

function formatScheduledLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ScheduleNextLiveCard({ project, getToken, onSaved }: Props) {
  const [value, setValue] = useState<string>(toDatetimeLocal(project.scheduled_live_at));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<"ok" | "err" | null>(null);

  // Re-sync the input when the prop refreshes after a save round-trip.
  useEffect(() => {
    setValue(toDatetimeLocal(project.scheduled_live_at));
  }, [project.scheduled_live_at]);

  const currentLabel = formatScheduledLabel(project.scheduled_live_at);

  async function save() {
    if (!value || saving) return;
    setSaving(true);
    setSaved(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      // datetime-local gives us local-zone wall time; new Date() in the
      // browser interprets it as local; toISOString() emits UTC. That's
      // what the TIMESTAMPTZ column expects.
      const iso = new Date(value).toISOString();
      const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(project.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ scheduled_live_at: iso }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setSaved("ok");
      onSaved();
    } catch {
      setSaved("err");
    } finally {
      setSaving(false);
      // Clear the success/error flash after 3s.
      window.setTimeout(() => setSaved(null), 3000);
    }
  }

  return (
    <section className="rounded-2xl border border-default bg-surface-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-teal">
            Next live
          </div>
          <h3 className="mt-1 text-base font-bold text-primary">
            Schedule your next show
          </h3>
        </div>
        {currentLabel && (
          <span className="rounded-full border border-default bg-brand-teal-soft px-3 py-1 text-[11px] font-mono text-brand-teal">
            {currentLabel}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-secondary">
        Customers visiting your storefront will see a &ldquo;Going live&rdquo; banner with this time, so they can come back when you start. Pick a recurring weekly slot that fits your slow hours.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-secondary">
            Date and time
          </span>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-xl border border-default bg-surface-page px-3 py-2 text-sm text-primary outline-none transition focus:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/40"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={!value || saving}
          className="rounded-xl bg-brand-teal px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-brand-navy transition hover:bg-brand-teal-hover hover:text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : currentLabel ? "Update" : "Save"}
        </button>
      </div>
      {saved === "ok" && (
        <div className="mt-2 text-[11px] text-brand-teal">Saved. Storefront banner will update on next page load.</div>
      )}
      {saved === "err" && (
        <div className="mt-2 text-[11px] text-state-live">Save failed. Try again in a moment.</div>
      )}
    </section>
  );
}
