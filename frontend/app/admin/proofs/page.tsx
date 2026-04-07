"use client";

import { useEffect, useState, useCallback } from "react";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Proof = {
  id: string;
  external_business_id: string;
  buyer_privy_id: string;
  receipt_text: string | null;
  purchase_amount_usd: number | null;
  purchase_date: string | null;
  status: string;
  dum_points_awarded: number;
  verification_notes: string | null;
  created_at: string;
};

type Metrics = {
  external_businesses_discovered: number;
  demand_views: number;
  demand_clicks: number;
  purchase_proofs_submitted: number;
  purchase_proofs_verified: number;
  purchase_proofs_pending: number;
  dum_points_awarded_off_platform: number;
  merchant_outreach_queued: number;
  merchant_outreach_sent: number;
  businesses_claimed: number;
};

export default function AdminProofsPage() {
  const { getToken } = useAuth();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tab, setTab] = useState<"pending" | "verified" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const [proofsRes, metricsRes] = await Promise.all([
        fetch(`${API_BASE}/api/external/all-proofs?status=${tab}`, { headers }),
        fetch(`${API_BASE}/api/external/metrics`, { headers }),
      ]);

      if (proofsRes.ok) setProofs(await proofsRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } catch (e) {
      console.error("Failed to load admin data:", e);
    } finally {
      setLoading(false);
    }
  }, [getToken, tab]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleVerify(proofId: string, status: "verified" | "rejected") {
    setActionLoading(proofId);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/external/verify-proof`, {
        method: "POST",
        headers,
        body: JSON.stringify({ proof_id: proofId, status, verification_notes: "" }),
      });

      if (res.ok) {
        setProofs((prev) => prev.filter((p) => p.id !== proofId));
        loadData();
      }
    } catch (e) {
      console.error("Verify failed:", e);
    } finally {
      setActionLoading(null);
    }
  }

  const TABS = [
    { key: "pending" as const, label: "Pending" },
    { key: "verified" as const, label: "Verified" },
    { key: "rejected" as const, label: "Rejected" },
  ];

  return (
    <AdminRoute>
      <div className="min-h-screen bg-zinc-950 px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-xl font-bold text-white">Off-Platform Purchase Proofs</h1>
          <p className="mt-1 text-sm text-zinc-500">Review, verify, or reject purchase proofs from external businesses.</p>

          {/* Metrics */}
          {metrics && (
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Proofs Pending", value: metrics.purchase_proofs_pending },
                { label: "Proofs Verified", value: metrics.purchase_proofs_verified },
                { label: "DUM Awarded", value: metrics.dum_points_awarded_off_platform },
                { label: "Businesses Discovered", value: metrics.external_businesses_discovered },
                { label: "Outreach Queued", value: metrics.merchant_outreach_queued },
                { label: "Outreach Sent", value: metrics.merchant_outreach_sent },
                { label: "Businesses Claimed", value: metrics.businesses_claimed },
                { label: "Total Proofs", value: metrics.purchase_proofs_submitted },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-600">{m.label}</div>
                  <div className="mt-1 text-lg font-bold text-white">{m.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div className="mt-6 flex gap-1 rounded-xl bg-zinc-900/50 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-lg py-2 text-[12px] font-semibold transition ${tab === t.key ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Proof list */}
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="py-8 text-center text-sm text-zinc-600">Loading...</div>
            ) : proofs.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-600">No {tab} proofs.</div>
            ) : (
              proofs.map((p) => (
                <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[10px] text-zinc-600">Business: {p.external_business_id.slice(0, 8)}...</div>
                      <div className="mt-0.5 text-[10px] text-zinc-600">Buyer: {p.buyer_privy_id.slice(0, 15)}...</div>
                      <div className="mt-1 text-sm text-zinc-300">
                        ${p.purchase_amount_usd?.toFixed(2) || "0.00"} on {p.purchase_date || "unknown"}
                      </div>
                      {p.receipt_text && (
                        <div className="mt-1 rounded-lg bg-zinc-900 px-3 py-2 text-[11px] text-zinc-400">{p.receipt_text}</div>
                      )}
                      {p.dum_points_awarded > 0 && (
                        <div className="mt-1 text-[11px] font-semibold text-emerald-400">+{p.dum_points_awarded} DUM awarded</div>
                      )}
                      {p.verification_notes && (
                        <div className="mt-1 text-[10px] text-zinc-500">Note: {p.verification_notes}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`text-[10px] font-bold uppercase ${p.status === "verified" ? "text-emerald-400" : p.status === "rejected" ? "text-red-400" : "text-amber-400"}`}>
                        {p.status}
                      </div>
                      <div className="mt-0.5 text-[9px] text-zinc-600">{new Date(p.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>

                  {tab === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => handleVerify(p.id, "verified")}
                        disabled={actionLoading === p.id}
                        className="flex-1 rounded-lg bg-emerald-400 py-2 text-[11px] font-bold text-black transition hover:bg-emerald-300 disabled:opacity-50"
                      >
                        {actionLoading === p.id ? "..." : "Verify + Award 10 DUM"}
                      </button>
                      <button
                        onClick={() => handleVerify(p.id, "rejected")}
                        disabled={actionLoading === p.id}
                        className="flex-1 rounded-lg border border-zinc-700 py-2 text-[11px] text-zinc-400 transition hover:text-red-400 hover:border-red-400/30 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AdminRoute>
  );
}
