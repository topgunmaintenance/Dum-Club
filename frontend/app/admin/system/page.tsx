"use client";

import { useEffect, useState, useCallback } from "react";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";

import { API_BASE } from "../../../lib/apiBase";
const FE_COMMIT = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || "";

type HealthResult = {
  ok: boolean;
  status: "healthy" | "degraded" | "broken";
  system: string;
  message: string;
  checked_at: string;
  details: Record<string, unknown>;
};

const SYSTEMS = [
  { key: "root", endpoint: "/api/health", label: "Backend API", requiresAuth: false },
  { key: "deployment", endpoint: "/api/health/deployment", label: "Deployment Alignment", requiresAuth: true },
  { key: "database", endpoint: "/api/health/database", label: "Database", requiresAuth: true },
  { key: "offers", endpoint: "/api/health/offers", label: "Offers System", requiresAuth: true },
  { key: "checkout", endpoint: "/api/health/checkout", label: "Checkout / Stripe", requiresAuth: true },
  { key: "trading", endpoint: "/api/health/trading", label: "Token Trading", requiresAuth: true },
];

const STATUS_STYLES: Record<string, { border: string; bg: string; text: string; dot: string }> = {
  healthy: { border: "border-emerald-500/30", bg: "bg-emerald-500/5", text: "text-emerald-400", dot: "bg-emerald-500" },
  degraded: { border: "border-amber-500/30", bg: "bg-amber-500/5", text: "text-amber-400", dot: "bg-amber-500" },
  broken: { border: "border-red-500/30", bg: "bg-red-500/5", text: "text-red-400", dot: "bg-red-500" },
  loading: { border: "border-zinc-700", bg: "bg-zinc-900/50", text: "text-zinc-500", dot: "bg-zinc-600" },
  error: { border: "border-red-500/20", bg: "bg-red-500/5", text: "text-red-400", dot: "bg-red-600" },
};

function StatusCard({ label, result, loading: isLoading, error }: {
  label: string;
  result: HealthResult | null;
  loading: boolean;
  error: string | null;
}) {
  const state = isLoading ? "loading" : error ? "error" : result?.status || "loading";
  const s = STATUS_STYLES[state] || STATUS_STYLES.loading;

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-4 sm:p-5`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot} ${isLoading ? "animate-pulse" : ""}`} />
        <span className="text-sm font-semibold text-white">{label}</span>
        <span className={`ml-auto text-[10px] font-semibold uppercase tracking-[0.15em] ${s.text}`}>
          {isLoading ? "checking..." : error ? "error" : result?.status || "unknown"}
        </span>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">
        {isLoading ? "Running check..." : error ? error : result?.message || "No data"}
      </p>
      {result?.checked_at && !isLoading && (
        <p className="mt-2 text-[10px] text-zinc-600">
          Checked: {new Date(result.checked_at).toLocaleTimeString()}
        </p>
      )}
      {result?.details && !isLoading && Object.keys(result.details).length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-400">
            Details
          </summary>
          <pre className="mt-2 rounded-lg bg-base/50 border border-zinc-800 p-3 text-[11px] text-zinc-400 overflow-x-auto">
            {JSON.stringify(result.details, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function SystemHealthPage() {
  const { getToken } = useAuth();
  const [results, setResults] = useState<Record<string, HealthResult | null>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [recoveryRunning, setRecoveryRunning] = useState(false);
  const [recoveryResult, setRecoveryResult] = useState<any>(null);

  const runChecks = useCallback(async () => {
    const token = await getToken();

    for (const sys of SYSTEMS) {
      setLoading((p) => ({ ...p, [sys.key]: true }));
    }

    const fetchResults = SYSTEMS.map(async (sys) => {
      try {
        const headers: Record<string, string> = {};
        if (sys.requiresAuth && token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
        // Pass frontend commit hash to deployment endpoint so backend can compare
        const url = sys.key === "deployment" && FE_COMMIT
          ? `${API_BASE}${sys.endpoint}?fe_commit=${encodeURIComponent(FE_COMMIT)}`
          : `${API_BASE}${sys.endpoint}`;
        const res = await fetch(url, {
          cache: "no-store",
          headers,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = typeof errData.detail === "string" ? errData.detail : `HTTP ${res.status}`;
          setErrors((p) => ({ ...p, [sys.key]: msg }));
          setResults((p) => ({ ...p, [sys.key]: null }));
        } else {
          const data: HealthResult = await res.json();
          setResults((p) => ({ ...p, [sys.key]: data }));
          setErrors((p) => ({ ...p, [sys.key]: null }));
        }
      } catch (err) {
        setErrors((p) => ({
          ...p,
          [sys.key]: err instanceof Error ? err.message : "Network error",
        }));
        setResults((p) => ({ ...p, [sys.key]: null }));
      } finally {
        setLoading((p) => ({ ...p, [sys.key]: false }));
      }
    });

    await Promise.allSettled(fetchResults);
    setLastRunAt(new Date().toLocaleTimeString());
  }, [getToken]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(runChecks, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, runChecks]);

  // Summary
  const allResults = SYSTEMS.map((s) => results[s.key]).filter(Boolean) as HealthResult[];
  const healthyCount = allResults.filter((r) => r.status === "healthy").length;
  const degradedCount = allResults.filter((r) => r.status === "degraded").length;
  const brokenCount = allResults.filter((r) => r.status === "broken").length;
  const errorCount = SYSTEMS.filter((s) => errors[s.key]).length;
  const anyLoading = SYSTEMS.some((s) => loading[s.key]);
  const totalChecked = allResults.length + errorCount;

  let summaryText = "Running checks...";
  let summaryColor = "text-zinc-400";
  if (!anyLoading && totalChecked > 0) {
    if (brokenCount + errorCount === 0 && degradedCount === 0) {
      summaryText = "All systems healthy";
      summaryColor = "text-emerald-400";
    } else if (brokenCount + errorCount > 0) {
      summaryText = `${brokenCount + errorCount} system${brokenCount + errorCount > 1 ? "s" : ""} broken`;
      summaryColor = "text-red-400";
    } else {
      summaryText = `${degradedCount} system${degradedCount > 1 ? "s" : ""} need${degradedCount === 1 ? "s" : ""} attention`;
      summaryColor = "text-amber-400";
    }
  }

  // Full diagnostic JSON
  const diagnosticJson = JSON.stringify(
    SYSTEMS.reduce((acc, sys) => {
      acc[sys.key] = errors[sys.key]
        ? { error: errors[sys.key] }
        : results[sys.key] || { status: "not checked" };
      return acc;
    }, {} as Record<string, unknown>),
    null,
    2
  );

  return (
    <div className="min-h-screen bg-base text-white">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-600 mb-1">Admin</div>
          <h1 className="text-2xl font-bold text-white">System Health</h1>
          <p className={`mt-2 text-sm font-medium ${summaryColor}`}>{summaryText}</p>
        </div>

        {/* ── Deploy Status Banner ── */}
        {(() => {
          const deployResult = results.deployment;
          const feCommit = FE_COMMIT || null;
          const beCommit = (deployResult?.details as any)?.backend_commit || null;
          const isPreview = typeof window !== "undefined" && window.location.hostname.includes("vercel.app") && !window.location.hostname.startsWith("dum-club.");
          const aligned = deployResult?.status === "healthy";
          const hasMismatch = deployResult && !aligned && feCommit && beCommit;

          return (
            <div className={`mb-6 rounded-xl border p-4 ${
              hasMismatch
                ? "border-red-500/30 bg-red-500/5"
                : isPreview
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-zinc-800 bg-zinc-900/30"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`inline-block h-2 w-2 rounded-full ${
                  hasMismatch ? "bg-red-500" : isPreview ? "bg-amber-500" : "bg-emerald-500"
                }`} />
                <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                  {isPreview ? "Preview Deploy" : "Production Deploy"}
                </span>
                {hasMismatch && (
                  <span className="ml-auto text-[10px] font-bold uppercase text-red-400">SHA Mismatch</span>
                )}
              </div>
              <div className="grid gap-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Frontend SHA</span>
                  <span className="text-zinc-300">{feCommit ? feCommit.slice(0, 12) : "not set"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Backend SHA</span>
                  <span className="text-zinc-300">{beCommit ? String(beCommit).slice(0, 12) : "not set"}</span>
                </div>
              </div>
              {hasMismatch && (
                <p className="mt-2 text-[11px] text-red-400/80">
                  Frontend and backend are running different commits. Merge and redeploy to align.
                </p>
              )}
              {isPreview && (
                <p className="mt-2 text-[11px] text-amber-400/80">
                  This is a preview deployment, not production. Changes here are not live.
                </p>
              )}
            </div>
          );
        })()}

        {/* Controls */}
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <button
            onClick={runChecks}
            disabled={anyLoading}
            className="rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {anyLoading ? "Checking..." : "Run Checks"}
          </button>
          <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-emerald-500"
            />
            Auto-refresh (30s)
          </label>
          {lastRunAt && (
            <span className="text-[10px] text-zinc-600 ml-auto">Last run: {lastRunAt}</span>
          )}
        </div>

        {/* Status Cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {SYSTEMS.map((sys) => (
            <StatusCard
              key={sys.key}
              label={sys.label}
              result={results[sys.key] || null}
              loading={loading[sys.key] || false}
              error={errors[sys.key] || null}
            />
          ))}
        </div>

        {/* Order Recovery */}
        {results.checkout?.details && (results.checkout.details as any).pending_payment_orders > 0 && (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <span className="text-sm font-semibold text-amber-400">
                  {(results.checkout.details as any).pending_payment_orders} orders stuck in pending_payment
                </span>
                <p className="text-xs text-zinc-400 mt-1">
                  These orders may have been paid in Stripe but the webhook didn't process them. Click Recover to check Stripe and update any that were actually paid.
                </p>
              </div>
              <button
                onClick={async () => {
                  const token = await getToken();
                  if (!token) return;
                  setRecoveryRunning(true);
                  setRecoveryResult(null);
                  try {
                    const res = await fetch(`${API_BASE}/api/checkout/orders/recover-pending`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    const data = await res.json();
                    setRecoveryResult(data);
                    runChecks(); // refresh health after recovery
                  } catch (err) {
                    setRecoveryResult({ error: err instanceof Error ? err.message : "Failed" });
                  } finally {
                    setRecoveryRunning(false);
                  }
                }}
                disabled={recoveryRunning}
                className="shrink-0 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-amber-400 disabled:opacity-50"
              >
                {recoveryRunning ? "Recovering..." : "Recover Orders"}
              </button>
            </div>
            {recoveryResult && (
              <pre className="mt-3 rounded-lg bg-base/50 border border-zinc-800 p-3 text-[11px] text-zinc-400 overflow-x-auto max-h-[200px] overflow-y-auto">
                {JSON.stringify(recoveryResult, null, 2)}
              </pre>
            )}
          </div>
        )}

        {/* Per-merchant order audit — read-only diagnostic. Enter a
            merchant's owner_id (privy_id or wallet UUID) and view their
            order distribution: counts by status, oldest pending_payment
            age, and how many have Stripe IDs vs none. NO mutation here.
            Use the existing "Recover Orders" button above to actually
            reconcile, after reviewing what's in the table. */}
        <OrdersAuditPanel getToken={getToken} />

        {/* Diagnostic JSON */}
        <details className="mt-8">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-400">
            Full Diagnostic JSON
          </summary>
          <div className="mt-3 relative">
            <button
              onClick={() => navigator.clipboard.writeText(diagnosticJson)}
              className="absolute top-2 right-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition"
            >
              Copy
            </button>
            <pre className="rounded-xl bg-zinc-900/50 border border-zinc-800 p-4 text-[11px] text-zinc-400 overflow-x-auto max-h-[400px] overflow-y-auto">
              {diagnosticJson}
            </pre>
          </div>
        </details>

        {/* Info */}
        <div className="mt-8 rounded-xl border border-zinc-800/50 bg-zinc-900/30 p-4 text-xs text-zinc-600 space-y-1">
          <p>Health checks are read-only. No data is created or modified.</p>
          <p>Deployment alignment requires <code className="text-zinc-500">RAILWAY_GIT_COMMIT_SHA</code> (auto-set by Railway) and <code className="text-zinc-500">NEXT_PUBLIC_GIT_COMMIT_SHA</code> / <code className="text-zinc-500">FRONTEND_COMMIT_SHA</code> env vars.</p>
        </div>
      </div>
    </div>
  );
}

export default function AdminSystemPage() {
  return (
    <AdminRoute>
      <SystemHealthPage />
    </AdminRoute>
  );
}

// ── Read-only per-merchant order audit panel ──
// Wires GET /api/health/orders-audit and renders the breakdown so the
// operator can see what's actually in the orders table before deciding
// whether to run recovery. No mutations from this component.
function OrdersAuditPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const [ownerId, setOwnerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!ownerId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in required.");
        return;
      }
      const res = await fetch(
        `${API_BASE}/api/health/orders-audit?owner_id=${encodeURIComponent(ownerId.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const orders = (result?.orders as Record<string, unknown>) || null;
  const stuck = (orders?.stuck_pending_payment as Record<string, unknown>) || null;
  const byStatus = (orders?.by_status as Record<string, number>) || {};
  const projects = (result?.projects as Array<{ id: string; slug?: string | null; name?: string | null }>) || [];

  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Per-merchant order audit (read-only)</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Enter an owner_id (privy_id or wallet UUID) to see their orders broken down by status. No data is changed by this view.
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          placeholder="owner_id (privy_id or UUID)"
          autoComplete="off"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-200 outline-none focus:border-zinc-600"
        />
        <button
          type="button"
          onClick={run}
          disabled={loading || !ownerId.trim()}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-200 transition hover:border-zinc-500 disabled:opacity-40"
        >
          {loading ? "Loading…" : "View audit"}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {result && stuck && (
        <div className="mt-4 space-y-3">
          {projects.length > 0 && (
            <div className="text-[11px] text-zinc-500">
              <span className="text-zinc-400">Projects:</span>{" "}
              {projects.map((p) => p.name || p.slug || p.id).join(" · ")}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">Total orders</div>
              <div className="mt-1 text-lg font-bold text-zinc-100">{String(orders?.total ?? 0)}</div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="text-[9px] uppercase tracking-[0.18em] text-amber-400">Pending payment</div>
              <div className="mt-1 text-lg font-bold text-amber-300">{String(stuck.count ?? 0)}</div>
              {typeof stuck.oldest_age_hours === "number" && (
                <div className="mt-1 text-[10px] text-amber-400/80">oldest {stuck.oldest_age_hours}h</div>
              )}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">With Stripe session</div>
              <div className="mt-1 text-lg font-bold text-zinc-100">{String(stuck.with_stripe_session_id ?? 0)}</div>
              <div className="mt-1 text-[10px] text-zinc-500">abandoned checkout likely</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500">No Stripe IDs</div>
              <div className="mt-1 text-lg font-bold text-zinc-100">{String(stuck.with_no_stripe_ids ?? 0)}</div>
              <div className="mt-1 text-[10px] text-zinc-500">test rows likely</div>
            </div>
          </div>

          {Object.keys(byStatus).length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">By status</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(byStatus).map(([status, count]) => (
                  <span
                    key={status}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300"
                  >
                    <span className="font-mono text-zinc-500">{status}</span>
                    <span className="font-semibold text-zinc-100">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(result.notes) && (result.notes as string[]).length > 0 && (
            <ul className="space-y-1 text-[11px] text-zinc-500">
              {(result.notes as string[]).map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
