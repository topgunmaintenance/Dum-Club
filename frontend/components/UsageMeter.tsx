"use client";

/**
 * UsageMeter — host-facing viewer-hour meter for the Manage console.
 *
 * The platform enforces per-tier limits (viewer cap per show, monthly
 * viewer-hour hard block), but merchants had no way to SEE the meter
 * running — they'd discover a limit by hitting it (owner feedback,
 * 2026-07-02). This card shows, at a glance:
 *   - viewer-hours used vs included this month (progress bar)
 *   - the overage rate that applies after the included budget
 *   - the hard ceiling where streaming pauses until next month
 *   - the per-show viewer cap for their tier
 *
 * Reads GET /api/merchant/usage (display-only; enforcement reads its
 * own copy). Renders nothing while loading or when the caller has no
 * merchant, so it's safe to mount unconditionally in the console.
 */

import { useEffect, useState } from "react";
import { API_BASE } from "../lib/apiBase";

type Usage = {
  has_merchant: boolean;
  plan_id?: string;
  included_viewer_hours?: number;
  used_viewer_hours?: number;
  live_viewer_hours?: number;
  replay_viewer_hours?: number;
  remaining_included_viewer_hours?: number;
  overage_rate_usd?: number;
  hard_block_viewer_hours?: number;
  percent_of_included?: number;
  max_concurrent_viewers?: number;
  max_concurrent_streams?: number;
};

export function UsageMeter({ getToken }: { getToken: () => Promise<string | null> }) {
  const [usage, setUsage] = useState<Usage | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/merchant/usage`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as Usage;
        if (!cancelled) setUsage(data);
      } catch {
        // Display-only card: fail silent, render nothing.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!usage || !usage.has_merchant) return null;

  const used = usage.used_viewer_hours ?? 0;
  const included = usage.included_viewer_hours ?? 0;
  const pct = Math.min(100, usage.percent_of_included ?? 0);
  const nearLimit = pct >= 80;
  const overIncluded = included > 0 && used >= included;
  const overageCents = Math.round((usage.overage_rate_usd ?? 0) * 100);

  return (
    <div className="rounded-2xl border border-default bg-surface-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">
          Viewer-hours this month
        </div>
        <div className="font-mono text-xs font-bold tabular-nums text-primary">
          {used.toLocaleString()} / {included.toLocaleString()}
        </div>
      </div>

      {/* Progress toward the included budget. Amber past 80% so the
          host sees the limit coming instead of hitting it. */}
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
        <div
          className={`h-full rounded-full transition-all ${
            overIncluded ? "bg-amber-500" : nearLimit ? "bg-amber-400" : "bg-mint-fill"
          }`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-secondary">
        {overIncluded ? (
          <>
            Past your included hours. Extra time bills at {overageCents}¢ per
            viewer-hour (waived if your sales fees already cover it). Streaming
            pauses for the month at{" "}
            {Math.round(usage.hard_block_viewer_hours ?? 0).toLocaleString()} hours.
          </>
        ) : nearLimit ? (
          <>
            {Math.round(usage.remaining_included_viewer_hours ?? 0).toLocaleString()}{" "}
            included hours left. After that, {overageCents}¢ per viewer-hour
            (waived if your sales fees cover it).
          </>
        ) : (
          <>
            Included in your plan. After {included.toLocaleString()} hours:{" "}
            {overageCents}¢ per viewer-hour, waived if your sales fees cover it.
          </>
        )}{" "}
        Up to {usage.max_concurrent_viewers?.toLocaleString()} viewers per show.
      </p>

      {/* Live vs recorded split (queue 20) — shown once replays have
          actually consumed hours so merchants understand the bill. */}
      {(usage.replay_viewer_hours ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-muted">
          {(usage.live_viewer_hours ?? 0).toLocaleString()} live ·{" "}
          {(usage.replay_viewer_hours ?? 0).toLocaleString()} recorded video
        </p>
      )}
    </div>
  );
}
