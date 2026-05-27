"use client";

/**
 * Admin Operations Overview.
 *
 * One-call snapshot of platform operational health: active livestreams,
 * monthly viewer-hour consumption, cap-warning merchants, last-30-day
 * Stripe platform fees, last-7-day stream activity.
 *
 * Backed by GET /api/admin/operations/overview (admin-gated). The page
 * polls every 30s so an admin watching during outreach hours sees
 * live streams enter/leave the table without manual refresh.
 *
 * Admin-gated via the existing AdminRoute wrapper.
 */

import { useCallback, useEffect, useState } from "react";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";
import { API_BASE } from "../../../lib/apiBase";

type ActiveStream = {
  id: string;
  project_id: string;
  merchant_id: string | null;
  provider: string;
  start_at: string;
  peak_concurrent: number;
  project_name?: string | null;
  project_slug?: string | null;
};

type CapWarning = {
  merchant_id: string;
  used_hours: number;
  cap_hours: number;
  pct_of_cap: number;
};

type Overview = {
  as_of: string;
  yyyymm: string;
  active_streams: { count: number; rows: ActiveStream[] };
  this_month_usage: {
    viewer_hours: number;
    stream_count: number;
    merchant_count: number;
  };
  cap_warnings: CapWarning[];
  stripe_fees_30d: { platform_fee_usd: number; gmv_usd: number; order_count: number };
  recent_streams_7d: { total_streams: number; distinct_merchants: number };
};

function fmtDuration(startIso: string): string {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return "—";
  const mins = Math.floor((Date.now() - start) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remM = mins % 60;
  return `${hrs}h ${remM}m`;
}

function OpsPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/admin/operations/overview`, { headers });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as Overview;
      setData(body);
      setError(null);
      setLastFetch(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-200">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold text-white">Operations</h1>
          <div className="text-xs text-zinc-500">
            {data ? `Updated ${new Date(data.as_of).toLocaleTimeString()}` : loading ? "Loading..." : "—"}
            {error && <span className="ml-2 text-red-400">{error}</span>}
          </div>
        </div>

        {/* Top-row aggregates */}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Active streams"
            value={data?.active_streams.count ?? "—"}
            sub={data ? `${data.active_streams.rows.length} listed below` : ""}
          />
          <Stat
            label={`Viewer-hours · ${data?.yyyymm ?? "—"}`}
            value={data?.this_month_usage.viewer_hours.toLocaleString() ?? "—"}
            sub={
              data
                ? `${data.this_month_usage.stream_count} streams · ${data.this_month_usage.merchant_count} merchants`
                : ""
            }
          />
          <Stat
            label="Stripe fees · 30d"
            value={data ? `$${data.stripe_fees_30d.platform_fee_usd.toLocaleString()}` : "—"}
            sub={
              data
                ? `from $${data.stripe_fees_30d.gmv_usd.toLocaleString()} GMV · ${data.stripe_fees_30d.order_count} orders`
                : ""
            }
          />
          <Stat
            label="Streams · 7d"
            value={data?.recent_streams_7d.total_streams ?? "—"}
            sub={data ? `${data.recent_streams_7d.distinct_merchants} distinct merchants` : ""}
          />
        </div>

        {/* Cap warnings */}
        <Section title="Cap warnings (≥70% of monthly viewer-hour cap)">
          {!data ? (
            <div className="text-sm text-zinc-500">Loading...</div>
          ) : data.cap_warnings.length === 0 ? (
            <div className="text-sm text-zinc-500">No merchants are approaching their monthly viewer-hour cap.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="py-2 pr-3">Merchant</th>
                  <th className="py-2 pr-3">Used</th>
                  <th className="py-2 pr-3">Cap</th>
                  <th className="py-2 pr-3">% of cap</th>
                </tr>
              </thead>
              <tbody>
                {data.cap_warnings.map((w) => (
                  <tr key={w.merchant_id} className="border-t border-zinc-800">
                    <td className="py-2 pr-3 font-mono text-xs text-zinc-300">{w.merchant_id.slice(0, 8)}...</td>
                    <td className="py-2 pr-3">{w.used_hours.toLocaleString()}h</td>
                    <td className="py-2 pr-3">{w.cap_hours.toLocaleString()}h</td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-bold ${
                          w.pct_of_cap >= 90
                            ? "bg-red-500/15 text-red-400"
                            : "bg-amber-500/15 text-amber-400"
                        }`}
                      >
                        {w.pct_of_cap}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        {/* Active streams */}
        <Section title="Active livestreams right now">
          {!data ? (
            <div className="text-sm text-zinc-500">Loading...</div>
          ) : data.active_streams.rows.length === 0 ? (
            <div className="text-sm text-zinc-500">Nothing live at the moment.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="py-2 pr-3">Project</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Duration</th>
                  <th className="py-2 pr-3">Peak viewers</th>
                </tr>
              </thead>
              <tbody>
                {data.active_streams.rows.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-800">
                    <td className="py-2 pr-3">
                      <a
                        href={`/project/${s.project_slug || s.project_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        {s.project_name || s.project_id.slice(0, 8) + "..."}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-zinc-400">{s.provider}</td>
                    <td className="py-2 pr-3 text-zinc-400">{fmtDuration(s.start_at)}</td>
                    <td className="py-2 pr-3 text-zinc-400">{s.peak_concurrent || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="mt-4 text-[11px] text-zinc-600">
          Auto-refreshes every 30s. Last fetched {lastFetch ? `${Math.floor((Date.now() - lastFetch) / 1000)}s ago` : "—"}.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-zinc-400">{title}</div>
      {children}
    </div>
  );
}

export default function AdminOperationsPage() {
  return (
    <AdminRoute>
      <OpsPage />
    </AdminRoute>
  );
}
