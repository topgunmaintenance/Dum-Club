"use client";

/**
 * ReportButton — discreet "report this storefront" control for the
 * customer storefront view. Trust & safety: lets any viewer flag a
 * stream/business for operator review (POST /api/reports/). Anonymous by
 * default (no auth header needed); the endpoint attaches the reporter id
 * when a session token is present.
 */

import { useState } from "react";
import { API_BASE } from "../lib/apiBase";

const REASONS = ["spam", "scam", "inappropriate", "counterfeit", "other"];

export function ReportButton({ projectId }: { projectId: string }) {
  const [done, setDone] = useState(false);

  if (done) {
    return <span className="text-[11px] text-muted">Thanks, your report was received.</span>;
  }

  return (
    <button
      type="button"
      onClick={async () => {
        const raw = window.prompt(
          "Report this storefront. Reason: spam, scam, inappropriate, counterfeit, or other.",
          "",
        );
        if (raw === null) return;
        const r = raw.trim().toLowerCase();
        const known = REASONS.includes(r);
        const reason = known ? r : "other";
        const details = known ? undefined : raw.trim() || undefined;
        try {
          await fetch(`${API_BASE}/api/reports/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ project_id: projectId, reason, details }),
          });
        } catch {
          // Best-effort — never block the customer; still acknowledge.
        }
        setDone(true);
      }}
      className="text-[11px] text-muted underline-offset-2 transition hover:text-secondary hover:underline"
    >
      Report this storefront
    </button>
  );
}
