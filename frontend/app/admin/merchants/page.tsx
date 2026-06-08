"use client";

/**
 * Owner page — every business that has signed up.
 *
 * Plain business name, email, signup date, payment-account status,
 * whether the shop is visible on Discover, and how many shop pages
 * the business has. Lets the owner monitor new signups at a glance.
 *
 * Backed by GET /api/admin/merchants (owner-gated by the same
 * is_admin check used for /admin/operations). One-shot fetch on
 * mount; click "Refresh" to re-pull. No polling — signups don't
 * arrive fast enough to justify it.
 *
 * Owner-gated via the existing AdminRoute wrapper. Non-owners are
 * sent to the homepage by AdminRoute before this page renders.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";
import { API_BASE } from "../../../lib/apiBase";

type MerchantRow = {
  merchant_id: string | null;
  business_name: string | null;
  owner_privy_id: string;
  owner_email: string | null;
  signup_date: string | null;
  stripe_connect_status: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  founding_merchant: boolean | null;
  project_count: number;
  primary_project: {
    id: string | null;
    slug: string | null;
    status: string | null;
    visibility: string | null;
    verified: boolean | null;
    is_live: boolean | null;
  } | null;
  discoverable: boolean;
};

function formatSignupDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "—";
  }
}

function StatusPill({
  kind,
  children,
}: {
  kind: "ok" | "warn" | "muted" | "live";
  children: React.ReactNode;
}) {
  const cls =
    kind === "ok"
      ? "border-brand-teal/40 bg-brand-teal-soft text-brand-teal"
      : kind === "warn"
        ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
        : kind === "live"
          ? "border-state-live/40 bg-state-live/10 text-state-live"
          : "border-default bg-surface-muted text-secondary";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${cls}`}
    >
      {children}
    </span>
  );
}

function paymentPillKind(s: string | null): "ok" | "warn" | "muted" {
  if (s === "verified") return "ok";
  if (s === "connected") return "warn";
  return "muted";
}

function paymentPillLabel(s: string | null): string {
  if (s === "verified") return "Ready to be paid";
  if (s === "connected") return "Reviewing payment account";
  if (s === "not_connected") return "Payment account not set up";
  return s || "—";
}

function MerchantsPanel() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<MerchantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/admin/merchants`, { headers });
      if (!res.ok) {
        throw new Error(`Could not load businesses (HTTP ${res.status}).`);
      }
      const data = await res.json();
      setRows(Array.isArray(data?.merchants) ? data.merchants : []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load businesses.",
      );
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const newestFirst = [...rows];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Businesses</h1>
          <p className="mt-1 text-xs text-secondary">
            Every business that has signed up. Newest first.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-default bg-surface-card px-3 py-1.5 text-xs font-bold text-primary transition hover:border-strong disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-state-live/30 bg-state-live/5 px-3 py-2 text-sm text-state-live">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-default bg-surface-card">
        <table className="w-full min-w-[960px] text-left text-xs">
          <thead className="bg-surface-page">
            <tr>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Business
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Owner email
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Signed up
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Payment account
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Plan
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                On Discover
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Live now
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Shop pages
              </th>
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Open shop
              </th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((r) => {
              const target = r.primary_project?.slug || r.primary_project?.id;
              const planLabel = r.subscription_tier
                ? `${r.subscription_tier}${r.subscription_status ? ` · ${r.subscription_status}` : ""}`
                : "—";
              return (
                <tr
                  key={r.merchant_id || r.owner_privy_id}
                  className="border-t border-default"
                >
                  <td className="px-3 py-2 font-medium text-primary">
                    {r.business_name || "—"}
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {r.owner_email || (
                      <span className="text-muted">no email</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {formatSignupDate(r.signup_date)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill kind={paymentPillKind(r.stripe_connect_status)}>
                      {paymentPillLabel(r.stripe_connect_status)}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2 text-secondary">{planLabel}</td>
                  <td className="px-3 py-2">
                    <StatusPill kind={r.discoverable ? "ok" : "muted"}>
                      {r.discoverable ? "Yes" : "Hidden"}
                    </StatusPill>
                  </td>
                  <td className="px-3 py-2">
                    {r.primary_project?.is_live ? (
                      <StatusPill kind="live">Live</StatusPill>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {r.project_count}
                  </td>
                  <td className="px-3 py-2">
                    {target ? (
                      <Link
                        href={`/project/${target}`}
                        className="text-brand-teal hover:underline"
                      >
                        {r.primary_project?.slug || "Open"}
                      </Link>
                    ) : (
                      <span className="text-muted">no shop yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && newestFirst.length === 0 && !error && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-secondary"
                >
                  No businesses have signed up yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export default function MerchantsAdminPage() {
  return (
    <AdminRoute>
      <MerchantsPanel />
    </AdminRoute>
  );
}
