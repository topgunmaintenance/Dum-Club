"use client";

/**
 * InvestorSignupForm — single-field email opt-in on /investors.
 *
 * POSTs to /api/investor-leads. The endpoint accepts repeat
 * submissions silently (returns 200 either way) so the buyer
 * doesn't have to remember whether they opted in before.
 *
 * Validation: HTML-native (type="email" + required) plus a
 * client-side trim. The backend revalidates with a stricter
 * regex on top of pydantic's EmailStr.
 *
 * No analytics, no third-party form provider, no new
 * dependencies. Tailwind utility classes only.
 */

import { useState } from "react";
import { Mail, Check } from "lucide-react";

import { API_BASE } from "../lib/apiBase";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export function InvestorSignupForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "submitting") return;
    const cleaned = email.trim();
    if (!cleaned) return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch(`${API_BASE}/api/investor-leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleaned, source: "investors_page" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail =
          typeof data?.detail === "string"
            ? data.detail
            : `Signup failed (HTTP ${res.status})`;
        setState({ kind: "error", message: detail });
        return;
      }
      setState({ kind: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setState({
        kind: "error",
        message: `Could not record signup. ${msg}`,
      });
    }
  }

  if (state.kind === "ok") {
    return (
      <div
        role="status"
        className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-default bg-brand-teal-soft p-4 text-sm text-brand-navy shadow-sm"
      >
        <Check
          className="h-5 w-5 shrink-0 text-brand-teal"
          strokeWidth={2.5}
          aria-hidden="true"
        />
        <div>
          <div className="font-bold">You&apos;re on the list.</div>
          <div className="mt-0.5 text-[12px] text-secondary">
            Investor updates will land in your inbox.
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Join Investor Updates"
      className="mx-auto flex max-w-md flex-col gap-3 sm:flex-row sm:items-stretch"
    >
      <label htmlFor="investor-email" className="sr-only">
        Email
      </label>
      <div className="relative flex-1">
        <Mail
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
          strokeWidth={2}
          aria-hidden="true"
        />
        <input
          id="investor-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state.kind === "submitting"}
          className="h-12 w-full rounded-xl border border-default bg-surface-card pl-9 pr-3 text-sm text-primary placeholder:text-muted outline-none transition focus:border-strong focus-visible:ring-2 focus-visible:ring-brand-teal/40 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>
      <button
        type="submit"
        disabled={state.kind === "submitting" || !email.trim()}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 text-sm font-bold uppercase tracking-[0.08em] text-brand-navy transition-colors hover:bg-brand-teal-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.kind === "submitting" ? "Sending…" : "Join Investor Updates"}
      </button>
      {state.kind === "error" && (
        <p
          role="alert"
          className="basis-full text-center text-[12px] font-medium text-state-live"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
