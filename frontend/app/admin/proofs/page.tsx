"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import AdminRoute from "../../../components/AdminRoute";
import { useAuth } from "../../../lib/auth/AuthContext";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──

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
  campaign_type: string | null;
  campaign_type_preview: string | null;
  points_expected: number | null;
  business_name: string | null;
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

type RewardPreview = {
  proof_id: string;
  business_name: string;
  buyer_privy_id: string;
  buyer_email: string;
  buyer_balance: number;
  purchase_amount_usd: number | null;
  purchase_date: string | null;
  campaign_type: string;
  points_expected: number;
  balance_after: number;
  already_awarded: boolean;
  status: string;
};

// ── Campaign badge config ──

const CAMPAIGN_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  lead_credit: {
    label: "New Business",
    color: "text-amber-300",
    bg: "bg-amber-400/10",
    border: "border-amber-400/25",
    icon: "★",
  },
  first_visit: {
    label: "First Visit",
    color: "text-sky-300",
    bg: "bg-sky-400/10",
    border: "border-sky-400/25",
    icon: "◆",
  },
  repeat_visit: {
    label: "Repeat Visit",
    color: "text-zinc-400",
    bg: "bg-zinc-700/30",
    border: "border-zinc-700",
    icon: "●",
  },
};

function CampaignBadge({ type }: { type: string | null }) {
  const cfg = type ? CAMPAIGN_CONFIG[type] : null;
  if (!cfg) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
        Determining...
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border ${cfg.border} ${cfg.bg} px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${cfg.color}`}>
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

function PointsBadge({ points, size = "sm" }: { points: number; size?: "sm" | "lg" }) {
  const sizeClass = size === "lg" ? "text-lg px-3 py-1" : "text-[11px] px-2 py-0.5";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 font-bold text-emerald-400 ${sizeClass}`}>
      +{points} DUM
    </span>
  );
}

// ── Verify Confirmation Modal ──

function VerifyModal({
  preview,
  loading,
  onConfirm,
  onCancel,
}: {
  preview: RewardPreview | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!preview) return null;
  const cfg = CAMPAIGN_CONFIG[preview.campaign_type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onCancel}>
      <div className="mx-4 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">Confirm Verification</div>
          <h2 className="mt-2 text-xl font-bold text-white">Award DUM Points?</h2>
        </div>

        {preview.already_awarded && (
          <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-center">
            <span className="text-sm font-bold text-amber-300">Already awarded — replay will award 0 DUM</span>
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Business</span>
            <span className="text-sm font-semibold text-white">{preview.business_name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Buyer</span>
            <span className="text-sm text-zinc-300">{preview.buyer_email || preview.buyer_privy_id.slice(0, 20) + "..."}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Purchase</span>
            <span className="text-sm text-white">${preview.purchase_amount_usd?.toFixed(2) || "0.00"}</span>
          </div>

          <div className="my-2 h-px bg-zinc-800" />

          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Campaign</span>
            <CampaignBadge type={preview.campaign_type} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Reward</span>
            <PointsBadge points={preview.already_awarded ? 0 : preview.points_expected} size="lg" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-500">Balance change</span>
            <span className="text-sm text-zinc-300">
              {preview.buyer_balance} → <span className="font-bold text-emerald-400">{preview.balance_after}</span>
            </span>
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-xl border border-zinc-700 py-3 text-sm font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-xl bg-emerald-400 py-3 text-sm font-bold text-black transition hover:bg-emerald-300 disabled:opacity-50"
          >
            {loading ? "Verifying..." : `Verify + Award ${preview.already_awarded ? 0 : preview.points_expected} DUM`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Grouped Proof Card ──

function ProofCard({
  proof,
  tab,
  onVerify,
  onReject,
  actionLoading,
}: {
  proof: Proof;
  tab: string;
  onVerify: (proofId: string) => void | Promise<void>;
  onReject: (proofId: string) => void | Promise<void>;
  actionLoading: string | null;
}) {
  const campaignType = proof.campaign_type || proof.campaign_type_preview;
  const points = proof.dum_points_awarded > 0 ? proof.dum_points_awarded : proof.points_expected;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 transition hover:border-zinc-700">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <CampaignBadge type={campaignType} />
            {points != null && points > 0 && <PointsBadge points={points} />}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span>Buyer: {proof.buyer_privy_id.slice(0, 18)}...</span>
            <span>${proof.purchase_amount_usd?.toFixed(2) || "0.00"}</span>
            <span>{proof.purchase_date || "no date"}</span>
          </div>

          {proof.receipt_text && (
            <div className="mt-2 rounded-lg bg-zinc-900/80 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
              {proof.receipt_text}
            </div>
          )}

          {proof.verification_notes && (
            <div className="mt-1.5 text-[10px] text-zinc-600">Note: {proof.verification_notes}</div>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className={`text-[10px] font-bold uppercase tracking-[0.1em] ${proof.status === "verified" ? "text-emerald-400" : proof.status === "rejected" ? "text-red-400" : "text-amber-400"}`}>
            {proof.status}
          </div>
          <div className="mt-0.5 text-[9px] text-zinc-600">{new Date(proof.created_at).toLocaleDateString()}</div>
          <div className="mt-0.5 text-[9px] text-zinc-700">ID: {proof.id.slice(0, 8)}</div>
        </div>
      </div>

      {tab === "pending" && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onVerify(proof.id)}
            disabled={actionLoading === proof.id}
            className="flex-1 rounded-lg bg-emerald-400 py-2.5 text-[11px] font-bold text-black transition hover:bg-emerald-300 disabled:opacity-50"
          >
            {actionLoading === proof.id ? "Loading preview..." : `Verify + Award ${points || "?"} DUM`}
          </button>
          <button
            onClick={() => onReject(proof.id)}
            disabled={actionLoading === proof.id}
            className="rounded-lg border border-zinc-700 px-4 py-2.5 text-[11px] text-zinc-400 transition hover:border-red-400/30 hover:text-red-400 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ── Business Group ──

type BuyerGroup = { buyerId: string; proofs: Proof[] };

type BusinessGroup = {
  businessId: string;
  businessName: string;
  proofs: Proof[];
  buyers: BuyerGroup[];
};

function groupByBusiness(proofs: Proof[]): BusinessGroup[] {
  const map: Record<string, Proof[]> = {};
  for (const p of proofs) {
    const key = p.external_business_id;
    if (!map[key]) map[key] = [];
    map[key].push(p);
  }

  const groups: BusinessGroup[] = [];
  for (const businessId of Object.keys(map)) {
    const bizProofs = map[businessId];
    const buyerMap: Record<string, Proof[]> = {};
    for (const p of bizProofs) {
      if (!buyerMap[p.buyer_privy_id]) buyerMap[p.buyer_privy_id] = [];
      buyerMap[p.buyer_privy_id].push(p);
    }
    const buyers: BuyerGroup[] = Object.keys(buyerMap).map((buyerId) => ({
      buyerId,
      proofs: buyerMap[buyerId],
    }));
    groups.push({
      businessId,
      businessName: bizProofs[0]?.business_name || "Unknown",
      proofs: bizProofs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
      buyers,
    });
  }

  // Sort groups: businesses with lead_credit proofs first
  groups.sort((a, b) => {
    const aHasLead = a.proofs.some((p) => (p.campaign_type_preview || p.campaign_type) === "lead_credit");
    const bHasLead = b.proofs.some((p) => (p.campaign_type_preview || p.campaign_type) === "lead_credit");
    if (aHasLead && !bHasLead) return -1;
    if (!aHasLead && bHasLead) return 1;
    return a.businessName.localeCompare(b.businessName);
  });

  return groups;
}

// ── Main Page ──

export default function AdminProofsPage() {
  const { getToken } = useAuth();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tab, setTab] = useState<"pending" | "verified" | "rejected">("pending");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Modal state
  const [modalPreview, setModalPreview] = useState<RewardPreview | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [getToken]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
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
  }, [authHeaders, tab]);

  useEffect(() => { loadData(); }, [loadData]);

  // Open confirmation modal — fetches full reward preview
  async function openVerifyModal(proofId: string) {
    setActionLoading(proofId);
    setVerifyError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/external/proof-reward-preview/${proofId}`, { headers });
      if (!res.ok) throw new Error("Preview failed");
      const preview: RewardPreview = await res.json();
      setModalPreview(preview);
    } catch (e) {
      console.error("Preview failed:", e);
      setVerifyError("Failed to load reward preview. Try again.");
    } finally {
      setActionLoading(null);
    }
  }

  // Execute verify after modal confirmation
  async function confirmVerify() {
    if (!modalPreview) return;
    setModalLoading(true);
    setVerifyError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/external/verify-proof`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          proof_id: modalPreview.proof_id,
          status: "verified",
          verification_notes: "",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Verification failed");
      }
      setModalPreview(null);
      setProofs((prev) => prev.filter((p) => p.id !== modalPreview.proof_id));
      loadData();
    } catch (e: any) {
      setVerifyError(e.message || "Verification failed");
    } finally {
      setModalLoading(false);
    }
  }

  async function handleReject(proofId: string) {
    setActionLoading(proofId);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/api/external/verify-proof`, {
        method: "POST",
        headers,
        body: JSON.stringify({ proof_id: proofId, status: "rejected", verification_notes: "" }),
      });
      if (res.ok) {
        setProofs((prev) => prev.filter((p) => p.id !== proofId));
        loadData();
      }
    } catch (e) {
      console.error("Reject failed:", e);
    } finally {
      setActionLoading(null);
    }
  }

  const groups = useMemo(() => groupByBusiness(proofs), [proofs]);

  // Summary counts for pending tab
  const pendingSummary = useMemo(() => {
    if (tab !== "pending") return null;
    const types = { lead_credit: 0, first_visit: 0, repeat_visit: 0 };
    let totalPoints = 0;
    for (const p of proofs) {
      const ct = (p.campaign_type_preview || p.campaign_type || "") as keyof typeof types;
      if (ct in types) types[ct]++;
      totalPoints += p.points_expected || 0;
    }
    return { ...types, totalPoints, totalProofs: proofs.length };
  }, [proofs, tab]);

  const TABS = [
    { key: "pending" as const, label: "Pending" },
    { key: "verified" as const, label: "Verified" },
    { key: "rejected" as const, label: "Rejected" },
  ];

  return (
    <AdminRoute>
      <div className="min-h-screen bg-zinc-950 px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">Off-Platform Purchase Proofs</h1>
              <p className="mt-1 text-sm text-zinc-500">Review, verify, or reject purchase proofs from external businesses.</p>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
            >
              {loading ? "..." : "Refresh"}
            </button>
          </div>

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

          {/* Pending Summary */}
          {pendingSummary && pendingSummary.totalProofs > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Queue:</span>
              {pendingSummary.lead_credit > 0 && (
                <span className="text-[11px] font-semibold text-amber-300">
                  {pendingSummary.lead_credit} new business ({pendingSummary.lead_credit * 25} DUM)
                </span>
              )}
              {pendingSummary.first_visit > 0 && (
                <span className="text-[11px] font-semibold text-sky-300">
                  {pendingSummary.first_visit} first visit ({pendingSummary.first_visit * 15} DUM)
                </span>
              )}
              {pendingSummary.repeat_visit > 0 && (
                <span className="text-[11px] font-semibold text-zinc-400">
                  {pendingSummary.repeat_visit} repeat ({pendingSummary.repeat_visit * 10} DUM)
                </span>
              )}
              <span className="ml-auto text-[11px] font-bold text-emerald-400">
                Total: {pendingSummary.totalPoints} DUM
              </span>
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

          {/* Error banner */}
          {verifyError && (
            <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3">
              <span className="text-sm text-red-300">{verifyError}</span>
              <button onClick={() => setVerifyError(null)} className="ml-3 text-[10px] text-red-400/60 hover:text-red-300">dismiss</button>
            </div>
          )}

          {/* Proof list — grouped by business */}
          <div className="mt-4 space-y-6">
            {loading ? (
              <div className="py-12 text-center text-sm text-zinc-600">Loading proofs...</div>
            ) : proofs.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-600">No {tab} proofs.</div>
            ) : (
              groups.map((group) => (
                <div key={group.businessId} className="rounded-2xl border border-zinc-800/70 bg-zinc-900/20 p-4">
                  {/* Business header */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-bold text-white">{group.businessName}</h3>
                      <span className="text-[10px] text-zinc-600">{group.proofs.length} proof{group.proofs.length > 1 ? "s" : ""}</span>
                      {group.proofs.some((p) => (p.campaign_type_preview || p.campaign_type) === "lead_credit") && (
                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-amber-300">
                          ★ New Business
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-zinc-700">{group.businessId.slice(0, 8)}</span>
                  </div>

                  {/* Buyer sub-groups */}
                  {group.buyers.map((bg: BuyerGroup) => (
                    <div key={bg.buyerId} className="mb-2 last:mb-0">
                      {group.buyers.length > 1 && (
                        <div className="mb-1.5 flex items-center gap-2 pl-1">
                          <div className="h-px w-3 bg-zinc-800" />
                          <span className="text-[10px] text-zinc-600">Buyer: {bg.buyerId.slice(0, 18)}...</span>
                          {bg.proofs.length > 1 && (
                            <span className="rounded-full border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 text-[9px] text-zinc-500">
                              {bg.proofs.length} visits
                            </span>
                          )}
                        </div>
                      )}
                      <div className="space-y-2">
                        {bg.proofs.map((p: Proof) => (
                          <ProofCard
                            key={p.id}
                            proof={p}
                            tab={tab}
                            onVerify={openVerifyModal}
                            onReject={handleReject}
                            actionLoading={actionLoading}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Verification confirmation modal */}
      <VerifyModal
        preview={modalPreview}
        loading={modalLoading}
        onConfirm={confirmVerify}
        onCancel={() => { setModalPreview(null); setVerifyError(null); }}
      />
    </AdminRoute>
  );
}
