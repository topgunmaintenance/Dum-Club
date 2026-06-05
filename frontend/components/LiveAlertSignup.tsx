"use client";

/**
 * LiveAlertSignup — storefront "get notified when this business goes
 * live" email capture, shown on EVERY storefront (customer view) when the
 * merchant has no upcoming scheduled show. The scheduled case is handled
 * by ScheduledLiveBanner; this is the always-on fallback so a visitor can
 * always opt in to the next go-live, not only when a time is posted.
 *
 * Submits to POST /api/projects/{id}/live-reminders, which stores a
 * "general" subscription (sentinel scheduled_for). The scheduled-reminder
 * cron never matches the sentinel; the instant go-live notifier
 * (services/agents/live_reminders.notify_project_live_now) emails these
 * subscribers when the merchant actually goes live.
 *
 * Same one-input/one-button + optimistic thank-you UX as
 * ScheduledLiveBanner.
 */

import { useState } from "react";
import { API_BASE } from "../lib/apiBase";

type Props = {
  projectId: string;
  businessName?: string;
  /** Optional prefill (e.g. the signed-in viewer's email). */
  defaultEmail?: string;
};

export function LiveAlertSignup({ projectId, businessName, defaultEmail }: Props) {
  const [email, setEmail] = useState(defaultEmail || "");
  const [state, setState] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string>("");

  const name = (businessName || "this business").trim();

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
            : "Couldn't save your alert right now. Try again.";
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
    <div className="mb-6 rounded-2xl border border-default bg-surface-card px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">🔔</span>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-teal">
              Live alerts
            </div>
            <div className="mt-0.5 text-sm font-semibold text-primary">
              Get an email when {name} goes live.
            </div>
          </div>
        </div>
        {state === "ok" ? (
          <div className="rounded-xl bg-brand-teal px-4 py-2 text-sm font-bold text-brand-navy">
            ✓ We&apos;ll email you when they go live.
          </div>
        ) : (
          <form
            onSubmit={subscribe}
            className="flex w-full max-w-xs flex-col gap-2 sm:flex-row"
          >
            <label className="sr-only" htmlFor="live-alert-email">
              Email for live alerts
            </label>
            <input
              id="live-alert-email"
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
              {state === "saving" ? "Saving..." : "Notify me"}
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
