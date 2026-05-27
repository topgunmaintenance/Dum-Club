"use client";

/**
 * ScheduledLiveBanner — storefront "Going live <day at time>" banner
 * + inline customer signup for the one-shot live reminder email.
 *
 * Renders only when scheduledIso parses to a future timestamp. The
 * storefront page gates render-time on !project.is_live and the
 * scheduledIso prop existing; this component handles the
 * already-in-the-past edge case internally and returns null.
 *
 * Signup is one input + one button. Submits to
 * POST /api/projects/{id}/live-reminders. Optimistic confirmation
 * flips the form to a thank-you state immediately and stays there
 * for the session — no need to keep the form clutter visible after
 * the customer has acted.
 */

import { useState } from "react";
import { API_BASE } from "../lib/apiBase";

type Props = {
  scheduledIso: string;
  projectId: string;
};

export function ScheduledLiveBanner({ scheduledIso, projectId }: Props) {
  const ts = new Date(scheduledIso);
  const valid = !Number.isNaN(ts.getTime()) && ts.getTime() > Date.now();

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string>("");

  if (!valid) return null;

  const label = ts.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || state === "saving") return;
    setState("saving");
    setErrMsg("");
    try {
      const res = await fetch(
        `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/live-reminders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : "Couldn't save your reminder right now. Try again.";
        setErrMsg(detail);
        setState("err");
        return;
      }
      setState("ok");
    } catch {
      setErrMsg("Couldn't reach DUM Club. Check your connection and try again.");
      setState("err");
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-brand-teal/30 bg-brand-teal-soft px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">📅</span>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-teal">
              Going live
            </div>
            <div className="mt-0.5 text-base font-bold text-primary">
              {label}
            </div>
          </div>
        </div>
        {state === "ok" ? (
          <div className="rounded-xl bg-brand-teal px-4 py-2 text-sm font-bold text-brand-navy">
            ✓ We&apos;ll email you when the show starts.
          </div>
        ) : (
          <form
            onSubmit={subscribe}
            className="flex w-full max-w-xs flex-col gap-2 sm:flex-row"
          >
            <label className="sr-only" htmlFor="live-reminder-email">
              Email for reminder
            </label>
            <input
              id="live-reminder-email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 rounded-xl border border-default bg-surface-page px-3 py-2 text-sm text-primary outline-none transition focus:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/40"
            />
            <button
              type="submit"
              disabled={!email.trim() || state === "saving"}
              className="rounded-xl bg-brand-teal px-4 py-2 text-sm font-bold text-brand-navy transition hover:bg-brand-teal-hover hover:text-white disabled:opacity-50"
            >
              {state === "saving" ? "Saving..." : "Remind me"}
            </button>
          </form>
        )}
      </div>
      {state === "err" && errMsg && (
        <div className="mt-2 text-[11px] text-state-live">{errMsg}</div>
      )}
    </div>
  );
}
