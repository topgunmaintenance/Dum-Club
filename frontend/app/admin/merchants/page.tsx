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

import React, { useCallback, useEffect, useState } from "react";
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
  admin_suspended?: boolean;
  admin_suspended_reason?: string | null;
  // admin-toolkit (2026-07-07): Stripe links + cancel button
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
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

// admin-toolkit (2026-07-07): roll-up numbers for the header cards.
type MerchantStats = {
  merchants_total: number;
  founding_used: number;
  founding_cap: number;
  with_subscription: number;
  trialing: number;
  connect_verified: number;
  orders_paid: number;
  gmv_usd: number;
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
  // Enforcement (2026-07-03): suspend/unsuspend per merchant, plus an
  // expandable offers list per row for single-listing takedowns.
  const [actingId, setActingId] = useState<string | null>(null);
  const [openOffersFor, setOpenOffersFor] = useState<string | null>(null);
  const [offersByMerchant, setOffersByMerchant] = useState<Record<string, any[]>>({});
  const [stats, setStats] = useState<MerchantStats | null>(null);
  const [copiedLinkFor, setCopiedLinkFor] = useState<string | null>(null);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getToken();
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers || {}),
      },
    });
  }, [getToken]);

  const toggleSuspend = useCallback(async (r: MerchantRow) => {
    if (!r.merchant_id) return;
    if (r.admin_suspended) {
      if (!window.confirm(`Unsuspend ${r.business_name || "this merchant"}? Their shop stays unpublished until they republish it.`)) return;
      setActingId(r.merchant_id);
      try {
        const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}/unsuspend`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unsuspend failed");
      } finally {
        setActingId(null);
      }
      return;
    }
    const reason = window.prompt(`Suspend ${r.business_name || "this merchant"}?

This blocks their broadcasts and ALL checkout immediately and hides their shops. Type the reason (they may see it):`);
    if (!reason || !reason.trim()) return;
    setActingId(r.merchant_id);
    try {
      const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suspend failed");
    } finally {
      setActingId(null);
    }
  }, [authedFetch]);

  // trial-starter (2026-07-06): backfill the 30-day founding trial for a
  // merchant that signed up before trials existed. Same Stripe path as
  // signup; the backend refuses if a subscription already exists.
  const startTrial = useCallback(async (r: MerchantRow) => {
    if (!r.merchant_id) return;
    if (!window.confirm(`Start the 30-day founding trial for ${r.business_name || "this merchant"}? Creates their Stripe customer + subscription with the trial clock ticking.`)) return;
    setActingId(r.merchant_id);
    try {
      const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}/start-trial`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(typeof d?.detail === "string" ? d.detail : `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trial start failed");
    } finally {
      setActingId(null);
    }
  }, [authedFetch]);

  const toggleOffers = useCallback(async (r: MerchantRow) => {
    if (!r.merchant_id) return;
    if (openOffersFor === r.merchant_id) {
      setOpenOffersFor(null);
      return;
    }
    setOpenOffersFor(r.merchant_id);
    try {
      const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}/offers`);
      if (res.ok) {
        const data = await res.json();
        setOffersByMerchant((p) => ({ ...p, [r.merchant_id as string]: data.offers || [] }));
      }
    } catch { /* row shows loading dash */ }
  }, [authedFetch, openOffersFor]);

  const actOnOffer = useCallback(async (merchantId: string, offer: any) => {
    if (offer.admin_removed) {
      if (!window.confirm(`Restore "${offer.title}"? It stays inactive until the merchant relists it.`)) return;
      const res = await authedFetch(`/api/admin/offers/${offer.id}/restore`, { method: "POST" });
      if (res.ok) toggleOffersRefresh(merchantId);
      return;
    }
    const reason = window.prompt(`Take down "${offer.title}"?

The merchant cannot relist it until you restore it. Reason:`);
    if (!reason || !reason.trim()) return;
    const res = await authedFetch(`/api/admin/offers/${offer.id}/takedown`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) toggleOffersRefresh(merchantId);
  }, [authedFetch]);

  const toggleOffersRefresh = useCallback(async (merchantId: string) => {
    try {
      const res = await authedFetch(`/api/admin/merchants/${merchantId}/offers`);
      if (res.ok) {
        const data = await res.json();
        setOffersByMerchant((p) => ({ ...p, [merchantId]: data.offers || [] }));
      }
    } catch { /* keep stale list */ }
  }, [authedFetch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const [res, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/merchants`, { headers }),
        fetch(`${API_BASE}/api/admin/merchants/stats`, { headers }),
      ]);
      if (!res.ok) {
        throw new Error(`Could not load businesses (HTTP ${res.status}).`);
      }
      const data = await res.json();
      setRows(Array.isArray(data?.merchants) ? data.merchants : []);
      // Stats are decoration — a failure there never blocks the table.
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load businesses.",
      );
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  // admin-toolkit (2026-07-07): cancel a merchant's subscription without
  // leaving the admin page.
  const cancelSubscription = useCallback(async (r: MerchantRow) => {
    if (!r.merchant_id) return;
    if (!window.confirm(`Cancel the Stripe subscription for ${r.business_name || "this merchant"}? Immediate, no more charges — this does not delete anything else.`)) return;
    setActingId(r.merchant_id);
    try {
      const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}/cancel-subscription`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(typeof d?.detail === "string" ? d.detail : `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setActingId(null);
    }
  }, [authedFetch, load]);

  // admin-toolkit (2026-07-07): mint a fresh trial Checkout link to send
  // a merchant whose card-upfront setup stalled. Copies to clipboard.
  const checkoutLink = useCallback(async (r: MerchantRow) => {
    if (!r.merchant_id) return;
    setActingId(r.merchant_id);
    try {
      const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}/checkout-link`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(typeof d?.detail === "string" ? d.detail : `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.url) {
        try {
          await navigator.clipboard.writeText(data.url);
          setCopiedLinkFor(r.merchant_id);
          setTimeout(() => setCopiedLinkFor(null), 4000);
        } catch {
          window.prompt("Copy the checkout link:", data.url);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout link failed");
    } finally {
      setActingId(null);
    }
  }, [authedFetch]);

  // admin-toolkit (2026-07-07): permanent delete with type-the-name
  // confirmation. For junk/test signups; real enforcement is Suspend.
  const deleteMerchant = useCallback(async (r: MerchantRow) => {
    if (!r.merchant_id) return;
    const typed = window.prompt(
      `PERMANENTLY delete ${r.business_name || "this merchant"}?

This removes their shop pages, offers, orders, and stream history, and cancels any Stripe subscription. It cannot be undone. Their login stays valid so they can sign up fresh.

Type the business name exactly to confirm:`,
    );
    if (typed == null) return;
    setActingId(r.merchant_id);
    try {
      const res = await authedFetch(`/api/admin/merchants/${r.merchant_id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm_name: typed }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(typeof d?.detail === "string" ? d.detail : `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setActingId(null);
    }
  }, [authedFetch, load]);

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

      {/* admin-toolkit (2026-07-07): roll-up stats. Internal-only —
          doctrine forbids these counts on public surfaces. */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Founding spots", value: `${stats.founding_used} / ${stats.founding_cap}` },
            { label: "Businesses", value: String(stats.merchants_total) },
            { label: "With subscription", value: String(stats.with_subscription) },
            { label: "Trialing", value: String(stats.trialing) },
            { label: "Paid orders", value: String(stats.orders_paid) },
            { label: "GMV", value: `$${stats.gmv_usd.toLocaleString(undefined, { minimumFractionDigits: 2 })}` },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-default bg-surface-card px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-secondary">{s.label}</div>
              <div className="mt-1 font-mono text-lg font-bold text-primary">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* admin-stats-accuracy (2026-07-07): no forced min-width — the
          enforcement buttons wrap instead, so the whole table fits the
          viewport without horizontal scrolling. */}
      <div className="overflow-x-auto rounded-xl border border-default bg-surface-card">
        <table className="w-full text-left text-xs">
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
              <th className="px-3 py-2 font-bold uppercase tracking-[0.08em] text-secondary">
                Enforcement
              </th>
            </tr>
          </thead>
          <tbody>
            {newestFirst.map((r) => {
              const target = r.primary_project?.slug || r.primary_project?.id;
              const planLabel = r.subscription_tier
                ? `${r.subscription_tier}${r.subscription_status ? ` · ${r.subscription_status}` : ""}`
                : "—";
              const offersOpen = openOffersFor === r.merchant_id;
              const offers = r.merchant_id ? offersByMerchant[r.merchant_id] : undefined;
              return (
                <React.Fragment key={r.merchant_id || r.owner_privy_id}>
                <tr
                  className={`border-t border-default ${r.admin_suspended ? "bg-state-live/[0.04]" : ""}`}
                >
                  <td className="px-3 py-2 font-medium text-primary">
                    {r.business_name || "—"}
                  </td>
                  <td className="max-w-[180px] break-all px-3 py-2 text-secondary">
                    {r.owner_email ? (
                      <a
                        href={`mailto:${r.owner_email}`}
                        className="text-brand-teal hover:underline"
                      >
                        {r.owner_email}
                      </a>
                    ) : (
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
                  <td className="px-3 py-2 text-secondary">
                    <div>{planLabel}</div>
                    {/* admin-toolkit: jump straight to Stripe */}
                    {(r.stripe_customer_id || r.stripe_subscription_id) && (
                      <div className="mt-0.5 flex gap-2">
                        {r.stripe_customer_id && (
                          <a
                            href={`https://dashboard.stripe.com/customers/${r.stripe_customer_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-brand-teal hover:underline"
                          >
                            Stripe customer ↗
                          </a>
                        )}
                        {r.stripe_subscription_id && (
                          <a
                            href={`https://dashboard.stripe.com/subscriptions/${r.stripe_subscription_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-brand-teal hover:underline"
                          >
                            Subscription ↗
                          </a>
                        )}
                      </div>
                    )}
                  </td>
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
                  <td className="px-3 py-2">
                    <div className="flex max-w-[240px] flex-wrap items-center gap-1.5">
                      {r.admin_suspended && (
                        <StatusPill kind="live">Suspended</StatusPill>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleSuspend(r)}
                        disabled={!r.merchant_id || actingId === r.merchant_id}
                        title={r.admin_suspended_reason || undefined}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-50 ${
                          r.admin_suspended
                            ? "border-default text-secondary hover:border-strong hover:text-primary"
                            : "border-state-live/40 text-state-live hover:bg-state-live/10"
                        }`}
                      >
                        {actingId === r.merchant_id ? "…" : r.admin_suspended ? "Unsuspend" : "Suspend"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleOffers(r)}
                        disabled={!r.merchant_id}
                        className="rounded-lg border border-default px-2.5 py-1 text-[11px] font-bold text-secondary transition hover:border-strong hover:text-primary disabled:opacity-50"
                      >
                        {offersOpen ? "Hide offers" : "Offers"}
                      </button>
                      {/* trial-starter (2026-07-06): backfill the 30-day
                          founding trial (no card) for merchants that
                          predate the trial code. admin-toolkit
                          (2026-07-07): hidden whenever a subscription
                          exists, alongside the new checkout-link path. */}
                      {!r.stripe_subscription_id && (
                        <>
                          <button
                            type="button"
                            onClick={() => startTrial(r)}
                            disabled={!r.merchant_id || actingId === r.merchant_id}
                            className="rounded-lg border border-default px-2.5 py-1 text-[11px] font-bold text-secondary transition hover:border-strong hover:text-mint-text disabled:opacity-50"
                          >
                            Start trial
                          </button>
                          <button
                            type="button"
                            onClick={() => checkoutLink(r)}
                            disabled={!r.merchant_id || actingId === r.merchant_id}
                            title="Creates a card-upfront trial Checkout link and copies it, so you can send it to the merchant."
                            className="rounded-lg border border-default px-2.5 py-1 text-[11px] font-bold text-secondary transition hover:border-strong hover:text-mint-text disabled:opacity-50"
                          >
                            {copiedLinkFor === r.merchant_id ? "Link copied ✓" : "Checkout link"}
                          </button>
                        </>
                      )}
                      {r.stripe_subscription_id && r.subscription_status !== "cancelled" && (
                        <button
                          type="button"
                          onClick={() => cancelSubscription(r)}
                          disabled={!r.merchant_id || actingId === r.merchant_id}
                          className="rounded-lg border border-default px-2.5 py-1 text-[11px] font-bold text-secondary transition hover:border-strong hover:text-primary disabled:opacity-50"
                        >
                          Cancel sub
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteMerchant(r)}
                        disabled={!r.merchant_id || actingId === r.merchant_id}
                        title="Permanently removes this business, its shop pages, offers, orders, and stream history. Type-the-name confirmation required."
                        className="rounded-lg border border-state-live/40 px-2.5 py-1 text-[11px] font-bold text-state-live transition hover:bg-state-live/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
                {offersOpen && (
                  <tr className="border-t border-default bg-surface-page">
                    <td colSpan={10} className="px-3 py-3">
                      {!offers ? (
                        <span className="text-secondary">Loading offers…</span>
                      ) : offers.length === 0 ? (
                        <span className="text-secondary">No offers.</span>
                      ) : (
                        <div className="space-y-1.5">
                          {offers.map((o: any) => (
                            <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-default bg-surface-card px-3 py-2">
                              <span className="font-medium text-primary">{o.title}</span>
                              <span className="font-mono text-secondary">${Number(o.price_usd || 0).toFixed(2)}</span>
                              <span className="text-muted">{o.project_title}</span>
                              {o.admin_removed ? (
                                <StatusPill kind="live">Removed</StatusPill>
                              ) : o.is_active ? (
                                <StatusPill kind="ok">Active</StatusPill>
                              ) : (
                                <StatusPill kind="muted">Inactive</StatusPill>
                              )}
                              <button
                                type="button"
                                onClick={() => r.merchant_id && actOnOffer(r.merchant_id, o)}
                                title={o.admin_removed_reason || undefined}
                                className={`ml-auto rounded-lg border px-2.5 py-1 text-[11px] font-bold transition ${
                                  o.admin_removed
                                    ? "border-default text-secondary hover:border-strong hover:text-primary"
                                    : "border-state-live/40 text-state-live hover:bg-state-live/10"
                                }`}
                              >
                                {o.admin_removed ? "Restore" : "Take down"}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
            {!loading && newestFirst.length === 0 && !error && (
              <tr>
                <td
                  colSpan={10}
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
