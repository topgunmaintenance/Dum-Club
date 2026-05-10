"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useStatusToast — small inline replacement for native window.alert().
 *
 * Returns a `notify(message, kind)` setter and a `<StatusToast />`
 * element you drop near the top of your page tree. The toast appears
 * top-right, auto-dismisses after AUTO_DISMISS_MS, and stays
 * dismissable via a close button.
 *
 * Why not a global toast provider: this file is intentionally
 * dependency-free + self-contained. The codebase already has
 * RewardToast (a one-purpose celebratory toast); this is the
 * neutral status / error variant for replacing alert() callsites
 * without dragging in a new provider into the root layout.
 *
 * Kinds map to brand-teal-soft (info / success) and state-live (error)
 * so the toast inherits the existing token system from the light-theme
 * migration. No new tokens, no new dependencies.
 */

type Kind = "info" | "success" | "error";
type Status = { kind: Kind; message: string } | null;

const AUTO_DISMISS_MS = 4500;

export function useStatusToast() {
  const [status, setStatus] = useState<Status>(null);

  const notify = useCallback((message: string, kind: Kind = "info") => {
    setStatus({ kind, message });
  }, []);

  const dismiss = useCallback(() => setStatus(null), []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [status]);

  const toast = status ? (
    <StatusToast status={status} onDismiss={dismiss} />
  ) : null;

  return { notify, toast };
}

function StatusToast({
  status,
  onDismiss,
}: {
  status: NonNullable<Status>;
  onDismiss: () => void;
}) {
  const { kind, message } = status;
  const palette =
    kind === "error"
      ? "border-[var(--state-live)]/40 bg-[var(--state-live)]/10 text-state-live"
      : kind === "success"
        ? "border-brand-teal bg-brand-teal-soft text-brand-navy"
        : "border-default bg-surface-card text-primary";

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-20 z-[200] flex justify-center px-4 sm:top-24"
    >
      <div
        className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-[0_8px_28px_rgba(11,18,32,0.12)] backdrop-blur-sm ${palette}`}
      >
        <span className="text-sm font-medium leading-snug">{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 ml-2 shrink-0 text-current opacity-60 transition hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
